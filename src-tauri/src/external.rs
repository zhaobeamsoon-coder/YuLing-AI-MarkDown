use crate::error::{AppError, AppResult};
use url::Url;

fn validate_external_url(input: &str) -> AppResult<String> {
    let parsed = Url::parse(input.trim())
        .map_err(|_| AppError::Invalid("外部链接地址无效".into()))?;
    match parsed.scheme() {
        "http" | "https" | "mailto" => Ok(parsed.to_string()),
        scheme => Err(AppError::Invalid(format!("不支持的外部链接协议：{scheme}"))),
    }
}

#[tauri::command]
pub fn open_external_url(url: String) -> AppResult<()> {
    let safe_url = validate_external_url(&url)?;
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("/usr/bin/open")
            .args(["-u", &safe_url])
            .spawn()?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = safe_url;
        Err(AppError::Invalid("当前平台暂不支持打开外部链接".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::validate_external_url;

    #[test]
    fn only_allows_browser_and_mail_links() {
        assert!(validate_external_url("https://openai.com/docs").is_ok());
        assert!(validate_external_url("mailto:writer@example.com").is_ok());
        for unsafe_url in ["javascript:alert(1)", "data:text/html,unsafe", "file:///etc/passwd"] {
            assert!(validate_external_url(unsafe_url).is_err());
        }
    }
}
