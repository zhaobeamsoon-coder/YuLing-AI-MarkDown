use crate::error::{AppError, AppResult};
use crate::export_paths::ExportState;
use crate::workspace::{atomic_write, authorized_root, WorkspaceState};
use chrono::{Datelike, Local};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf};
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetImport {
    pub absolute_path: String,
    pub markdown_path: String,
    pub reused: bool,
}

fn safe_file_name(original: &str) -> String {
    let candidate: String = original
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = candidate.trim_matches(['.', '-']);
    if trimmed.is_empty() {
        "image.png".to_string()
    } else {
        trimmed.chars().take(90).collect()
    }
}

#[tauri::command]
pub fn import_asset(
    state: State<'_, WorkspaceState>,
    workspace: String,
    bytes: Vec<u8>,
    original_name: String,
) -> AppResult<AssetImport> {
    let root = authorized_root(&state, &PathBuf::from(workspace))?;
    let now = Local::now();
    let digest = hex::encode(Sha256::digest(&bytes));
    let file_name = format!("{}-{}", &digest[..10], safe_file_name(&original_name));
    let relative = PathBuf::from("assets")
        .join(format!("{:04}", now.year()))
        .join(file_name);
    let destination = root.join(&relative);
    let reused = destination.exists();
    if !reused {
        atomic_write(&destination, &bytes)?;
    }
    Ok(AssetImport {
        absolute_path: destination.to_string_lossy().into_owned(),
        markdown_path: relative.to_string_lossy().replace('\\', "/"),
        reused,
    })
}

fn validate_workspace_layout(layout_json: &str) -> AppResult<()> {
    let parsed: serde_json::Value = serde_json::from_str(layout_json)?;
    if !matches!(
        parsed.get("version").and_then(serde_json::Value::as_u64),
        Some(1 | 2)
    ) {
        return Err(AppError::Invalid("不支持的布局版本".to_string()));
    }
    Ok(())
}

#[tauri::command]
pub fn save_workspace_layout(
    state: State<'_, WorkspaceState>,
    workspace: String,
    layout_json: String,
) -> AppResult<()> {
    let root = authorized_root(&state, &PathBuf::from(workspace))?;
    validate_workspace_layout(&layout_json)?;
    atomic_write(&root.join(".yulingmd/layout.json"), layout_json.as_bytes())
}

#[tauri::command]
pub fn load_workspace_layout(
    state: State<'_, WorkspaceState>,
    workspace: String,
) -> AppResult<String> {
    let root = authorized_root(&state, &PathBuf::from(workspace))?;
    let path = root.join(".yulingmd/layout.json");
    if !path.exists() {
        return Ok("{\"version\":1,\"documents\":{}}".to_string());
    }
    let content = fs::read_to_string(path)?;
    validate_workspace_layout(&content)?;
    Ok(content)
}

#[tauri::command]
pub fn write_export_file(
    state: State<'_, ExportState>,
    path: String,
    bytes: Vec<u8>,
) -> AppResult<()> {
    let destination = state.ensure_authorized(&PathBuf::from(path))?;
    let extension = destination
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !matches!(
        extension.to_ascii_lowercase().as_str(),
        "png" | "jpg" | "jpeg" | "html"
    ) {
        return Err(AppError::Invalid(
            "只允许导出 HTML、PNG 或 JPEG 文件".to_string(),
        ));
    }
    atomic_write(&destination, &bytes)
}

#[cfg(test)]
mod tests {
    use super::{safe_file_name, validate_workspace_layout};

    #[test]
    fn sanitizes_asset_names_without_losing_unicode() {
        assert_eq!(safe_file_name("截图 01?.png"), "截图-01-.png");
        assert_eq!(safe_file_name("../"), "image.png");
    }

    #[test]
    fn accepts_both_supported_layout_versions() {
        assert!(validate_workspace_layout(r#"{"version":1,"documents":{}}"#).is_ok());
        assert!(validate_workspace_layout(r#"{"version":2,"documents":{},"images":{}}"#).is_ok());
        assert!(validate_workspace_layout(r#"{"version":3}"#).is_err());
    }
}
