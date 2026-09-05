use crate::credentials;
use crate::error::{AppError, AppResult};
use crate::workspace::WorkspaceState;
use base64::Engine;
use chrono::Utc;
use hmac::{Hmac, Mac};
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::State;

const URL_PATH: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'`')
    .add(b'{')
    .add(b'}');

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectStorageConfig {
    pub kind: String,
    pub endpoint: String,
    pub bucket: String,
    pub region: Option<String>,
    pub public_base_url: String,
    pub credential_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageCredential {
    access_key_id: String,
    secret_access_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadedAsset {
    pub markdown_path: String,
    pub public_url: String,
}

fn encoded_path(path: &str) -> String {
    path.split('/')
        .map(|segment| utf8_percent_encode(segment, URL_PATH).to_string())
        .collect::<Vec<_>>()
        .join("/")
}

fn object_key(relative: &str, bytes: &[u8]) -> String {
    let digest = hex::encode(Sha256::digest(bytes));
    let name = Path::new(relative)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("image.bin");
    format!("yuling/{}/{}-{}", Utc::now().format("%Y/%m"), &digest[..12], name)
}

fn hmac_sha256(key: &[u8], content: &str) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts arbitrary key lengths");
    mac.update(content.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

async fn upload_s3(
    config: &ObjectStorageConfig,
    credential: &StorageCredential,
    key: &str,
    bytes: &[u8],
    content_type: &str,
) -> AppResult<String> {
    let endpoint = config.endpoint.trim_end_matches('/');
    let endpoint_url = reqwest::Url::parse(endpoint)
        .map_err(|error| AppError::Invalid(format!("图床地址不合法：{error}")))?;
    if endpoint_url.scheme() != "https" {
        return Err(AppError::Invalid("对象存储地址必须使用 HTTPS".to_string()));
    }
    let host = endpoint_url
        .host_str()
        .ok_or_else(|| AppError::Invalid("图床地址缺少主机名".to_string()))?;
    let region = config.region.as_deref().unwrap_or("auto");
    let encoded_key = encoded_path(key);
    let canonical_uri = format!("/{}/{encoded_key}", encoded_path(&config.bucket));
    let target = format!("{endpoint}{canonical_uri}");
    let timestamp = Utc::now();
    let amz_date = timestamp.format("%Y%m%dT%H%M%SZ").to_string();
    let date = timestamp.format("%Y%m%d").to_string();
    let payload_hash = hex::encode(Sha256::digest(bytes));
    let canonical_headers = format!("content-type:{content_type}\nhost:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n");
    let signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date";
    let canonical_request = format!("PUT\n{canonical_uri}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}");
    let scope = format!("{date}/{region}/s3/aws4_request");
    let string_to_sign = format!("AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}", hex::encode(Sha256::digest(canonical_request.as_bytes())));
    let date_key = hmac_sha256(format!("AWS4{}", credential.secret_access_key).as_bytes(), &date);
    let region_key = hmac_sha256(&date_key, region);
    let service_key = hmac_sha256(&region_key, "s3");
    let signing_key = hmac_sha256(&service_key, "aws4_request");
    let signature = hex::encode(hmac_sha256(&signing_key, &string_to_sign));
    let authorization = format!("AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed_headers}, Signature={signature}", credential.access_key_id);
    let response = reqwest::Client::new()
        .put(target)
        .header("content-type", content_type)
        .header("x-amz-content-sha256", payload_hash)
        .header("x-amz-date", amz_date)
        .header("authorization", authorization)
        .body(bytes.to_vec())
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(AppError::Invalid(format!("S3 上传失败：{}", response.status())));
    }
    Ok(format!("{}/{}", config.public_base_url.trim_end_matches('/'), encoded_key))
}

async fn upload_oss(
    config: &ObjectStorageConfig,
    credential: &StorageCredential,
    key: &str,
    bytes: &[u8],
    content_type: &str,
) -> AppResult<String> {
    let endpoint = config.endpoint.trim_end_matches('/');
    if !endpoint.starts_with("https://") {
        return Err(AppError::Invalid("阿里 OSS 地址必须使用 HTTPS".to_string()));
    }
    let encoded_key = encoded_path(key);
    let date = Utc::now().to_rfc2822();
    let resource = format!("/{}/{}", config.bucket, key);
    let string_to_sign = format!("PUT\n\n{content_type}\n{date}\n{resource}");
    let mut mac = Hmac::<Sha1>::new_from_slice(credential.secret_access_key.as_bytes())
        .map_err(|error| AppError::Invalid(error.to_string()))?;
    mac.update(string_to_sign.as_bytes());
    let signature = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());
    let response = reqwest::Client::new()
        .put(format!("{endpoint}/{encoded_key}"))
        .header("content-type", content_type)
        .header("date", &date)
        .header("authorization", format!("OSS {}:{signature}", credential.access_key_id))
        .body(bytes.to_vec())
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(AppError::Invalid(format!("OSS 上传失败：{}", response.status())));
    }
    Ok(format!("{}/{}", config.public_base_url.trim_end_matches('/'), encoded_key))
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

#[tauri::command]
pub async fn upload_assets(
    state: State<'_, WorkspaceState>,
    workspace: String,
    markdown_paths: Vec<String>,
    config: ObjectStorageConfig,
) -> AppResult<Vec<UploadedAsset>> {
    let root = state.authorized_root(&PathBuf::from(workspace))?;
    let credential_bytes = credentials::load(&config.credential_name)?;
    let credential: StorageCredential = serde_json::from_slice(&credential_bytes)
        .map_err(|_| AppError::Credential("对象存储凭据格式不正确".to_string()))?;
    let mut uploaded = Vec::new();
    for markdown_path in markdown_paths {
        let relative = PathBuf::from(&markdown_path);
        if relative.is_absolute() || relative.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
            return Err(AppError::Unauthorized(markdown_path));
        }
        let path = root.join(&relative);
        let canonical = path.canonicalize()?;
        if !canonical.starts_with(&root) {
            return Err(AppError::Unauthorized(canonical.display().to_string()));
        }
        let bytes = std::fs::read(&canonical)?;
        let key = object_key(&markdown_path, &bytes);
        let public_url = match config.kind.as_str() {
            "s3" => upload_s3(&config, &credential, &key, &bytes, content_type(&canonical)).await?,
            "oss" => upload_oss(&config, &credential, &key, &bytes, content_type(&canonical)).await?,
            _ => return Err(AppError::Invalid("不支持的对象存储类型".to_string())),
        };
        uploaded.push(UploadedAsset { markdown_path, public_url });
    }
    Ok(uploaded)
}

#[cfg(test)]
mod tests {
    use super::{encoded_path, object_key};

    #[test]
    fn storage_paths_encode_spaces_and_keep_segments() {
        assert_eq!(encoded_path("目录/a b.png"), "%E7%9B%AE%E5%BD%95/a%20b.png");
        let key = object_key("assets/截图.png", b"same bytes");
        assert!(key.ends_with("-截图.png"));
    }
}
