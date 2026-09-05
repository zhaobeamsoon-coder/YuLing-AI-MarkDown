use crate::error::{AppError, AppResult};
use crate::export_paths::ExportState;
use crate::workspace::{authorize_directory, WorkspaceState};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, State, Url};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct OpenFileState {
    pending: Mutex<Vec<PathBuf>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedMarkdown {
    pub workspace: String,
    pub path: String,
}

fn validate_markdown_file(path: &Path) -> AppResult<PathBuf> {
    let canonical = path.canonicalize()?;
    if !canonical.is_file()
        || canonical.extension().and_then(|value| value.to_str()) != Some("md")
        || canonical.components().any(|part| part.as_os_str() == ".yulingmd")
    {
        return Err(AppError::Invalid("请选择现有的 .md 文档".to_string()));
    }
    Ok(canonical)
}

fn authorize_opened_file(
    app: &AppHandle,
    workspace_state: &WorkspaceState,
    path: &Path,
) -> AppResult<OpenedMarkdown> {
    let path = validate_markdown_file(path)?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Invalid("Markdown 文档没有父目录".to_string()))?;
    let workspace = authorize_directory(app, workspace_state, parent)?;
    Ok(OpenedMarkdown {
        workspace,
        path: path.to_string_lossy().into_owned(),
    })
}

pub fn queue_opened_urls(state: &OpenFileState, urls: &[Url]) {
    let mut pending = state.pending.lock().expect("open file queue mutex poisoned");
    for url in urls {
        let Ok(path) = url.to_file_path() else { continue };
        if path.extension().and_then(|value| value.to_str()) == Some("md") && !pending.contains(&path) {
            pending.push(path);
        }
    }
}

#[tauri::command]
pub fn take_opened_markdown(
    app: AppHandle,
    open_state: State<'_, OpenFileState>,
    workspace_state: State<'_, WorkspaceState>,
) -> Vec<OpenedMarkdown> {
    let paths = std::mem::take(&mut *open_state.pending.lock().expect("open file queue mutex poisoned"));
    paths
        .iter()
        .filter_map(|path| authorize_opened_file(&app, &workspace_state, path).ok())
        .collect()
}

#[tauri::command]
pub async fn choose_markdown_file(
    app: AppHandle,
    workspace_state: State<'_, WorkspaceState>,
) -> AppResult<Option<OpenedMarkdown>> {
    let dialog_app = app.clone();
    let file = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .set_title("打开 Markdown 文档")
            .add_filter("Markdown", &["md"])
            .blocking_pick_file()
    })
    .await
    .map_err(|error| AppError::Invalid(error.to_string()))?;
    let Some(file) = file else { return Ok(None) };
    let path = file
        .into_path()
        .map_err(|_| AppError::Invalid("所选位置不是本地文件路径".to_string()))?;
    authorize_opened_file(&app, &workspace_state, &path).map(Some)
}

#[tauri::command]
pub async fn choose_markdown_save_path(
    app: AppHandle,
    workspace_state: State<'_, WorkspaceState>,
    export_state: State<'_, ExportState>,
    default_name: String,
) -> AppResult<Option<OpenedMarkdown>> {
    let dialog_app = app.clone();
    let file = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .set_title("另存 Markdown 文档")
            .set_file_name(default_name)
            .add_filter("Markdown", &["md"])
            .blocking_save_file()
    })
    .await
    .map_err(|error| AppError::Invalid(error.to_string()))?;
    let Some(file) = file else { return Ok(None) };
    let mut path = file
        .into_path()
        .map_err(|_| AppError::Invalid("所选位置不是本地文件路径".to_string()))?;
    if path.extension().is_none() {
        path.set_extension("md");
    }
    if path.extension().and_then(|value| value.to_str()) != Some("md") {
        return Err(AppError::Invalid("请选择 .md 文件".to_string()));
    }
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Invalid("Markdown 文档没有父目录".to_string()))?;
    let workspace = authorize_directory(&app, &workspace_state, parent)?;
    let path = export_state.authorize(&path)?;
    Ok(Some(OpenedMarkdown {
        workspace,
        path: path.to_string_lossy().into_owned(),
    }))
}

#[tauri::command]
pub fn write_markdown_copy(
    state: State<'_, ExportState>,
    path: String,
    content: String,
) -> AppResult<()> {
    let destination = state.ensure_authorized(&PathBuf::from(path))?;
    if destination.extension().and_then(|value| value.to_str()) != Some("md") {
        return Err(AppError::Invalid("只允许另存为 .md 文件".to_string()));
    }
    crate::workspace::atomic_write(&destination, content.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::{queue_opened_urls, validate_markdown_file, OpenFileState};
    use tauri::Url;
    use tempfile::tempdir;

    #[test]
    fn queues_only_unique_markdown_file_urls() {
        let directory = tempdir().unwrap();
        let markdown = directory.path().join("说明.md");
        std::fs::write(&markdown, "正文").unwrap();
        let state = OpenFileState::default();
        let markdown_url = Url::from_file_path(&markdown).unwrap();
        let text_url = Url::from_file_path(directory.path().join("说明.txt")).unwrap();

        queue_opened_urls(&state, &[markdown_url.clone(), markdown_url, text_url]);

        assert_eq!(state.pending.lock().unwrap().as_slice(), &[markdown]);
        assert!(validate_markdown_file(directory.path().join("不存在.md").as_path()).is_err());
    }
}
