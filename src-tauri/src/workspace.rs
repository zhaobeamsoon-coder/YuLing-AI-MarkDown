use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_fs::FsExt;
use walkdir::WalkDir;

#[derive(Default)]
pub struct WorkspaceState {
    roots: Mutex<HashSet<PathBuf>>,
}

impl WorkspaceState {
    pub fn authorized_root(&self, path: &Path) -> AppResult<PathBuf> {
        authorized_root(self, path)
    }
}

pub(crate) fn authorize_directory(
    app: &AppHandle,
    state: &WorkspaceState,
    path: &Path,
) -> AppResult<String> {
    let canonical = path.canonicalize()?;
    if !canonical.is_dir() {
        return Err(AppError::Invalid("请选择文件夹工作区".to_string()));
    }
    app.asset_protocol_scope()
        .allow_directory(&canonical, true)
        .map_err(|error| AppError::Invalid(error.to_string()))?;
    app.fs_scope()
        .allow_directory(&canonical, true)
        .map_err(|error| AppError::Invalid(error.to_string()))?;
    state
        .roots
        .lock()
        .expect("workspace roots mutex poisoned")
        .insert(canonical.clone());
    Ok(canonical.to_string_lossy().into_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentEntry {
    pub path: String,
    pub relative_path: String,
    pub title: String,
    pub modified_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentContent {
    pub content: String,
    pub modified_ms: u64,
}

fn validate_markdown_relative_path(relative_path: &str) -> AppResult<PathBuf> {
    let relative = PathBuf::from(relative_path);
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative.extension().and_then(|value| value.to_str()) != Some("md")
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)) || part.as_os_str() == ".yulingmd")
    {
        return Err(AppError::Invalid(
            "只允许操作工作区内的相对 Markdown 路径".to_string(),
        ));
    }
    Ok(relative)
}

fn validate_directory_relative_path(relative_path: &str) -> AppResult<PathBuf> {
    let relative = PathBuf::from(relative_path);
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)) || part.as_os_str() == ".yulingmd")
    {
        return Err(AppError::Invalid(
            "只允许操作工作区内的相对目录".to_string(),
        ));
    }
    Ok(relative)
}

fn existing_markdown_path(root: &Path, relative_path: &str) -> AppResult<PathBuf> {
    let root = root.canonicalize()?;
    let relative = validate_markdown_relative_path(relative_path)?;
    let path = root.join(relative).canonicalize()?;
    if !path.starts_with(root) || !path.is_file() {
        return Err(AppError::Unauthorized(path.display().to_string()));
    }
    Ok(path)
}

fn available_markdown_destination(root: &Path, relative_path: &str) -> AppResult<PathBuf> {
    let root = root.canonicalize()?;
    let relative = validate_markdown_relative_path(relative_path)?;
    let path = root.join(relative);
    if path.exists() {
        return Err(AppError::Invalid("目标文档已经存在，不会覆盖".to_string()));
    }
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Invalid("目标文档没有父目录".to_string()))?
        .canonicalize()?;
    if !parent.starts_with(root) || !parent.is_dir() {
        return Err(AppError::Unauthorized(parent.display().to_string()));
    }
    Ok(path)
}

fn existing_directory_path(root: &Path, relative_path: &str) -> AppResult<PathBuf> {
    let root = root.canonicalize()?;
    let path = root
        .join(validate_directory_relative_path(relative_path)?)
        .canonicalize()?;
    if path == root || !path.starts_with(&root) || !path.is_dir() {
        return Err(AppError::Unauthorized(path.display().to_string()));
    }
    Ok(path)
}

fn document_entry(root: &Path, path: &Path) -> AppResult<DocumentEntry> {
    let root = root.canonicalize()?;
    let relative = path
        .strip_prefix(root)
        .map_err(|_| AppError::Unauthorized(path.display().to_string()))?;
    Ok(DocumentEntry {
        path: path.to_string_lossy().into_owned(),
        relative_path: relative.to_string_lossy().replace('\\', "/"),
        title: path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        modified_ms: modified_ms(path)?,
    })
}

fn modified_ms(path: &Path) -> AppResult<u64> {
    Ok(path
        .metadata()?
        .modified()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64)
}

pub(crate) fn authorized_root(state: &WorkspaceState, path: &Path) -> AppResult<PathBuf> {
    let canonical = path
        .canonicalize()
        .map_err(|_| AppError::Unauthorized(path.display().to_string()))?;
    let roots = state.roots.lock().expect("workspace roots mutex poisoned");
    roots
        .iter()
        .find(|root| canonical.starts_with(root))
        .cloned()
        .ok_or_else(|| AppError::Unauthorized(canonical.display().to_string()))
}

pub(crate) fn atomic_write(path: &Path, content: &[u8]) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Invalid("文件没有父目录".to_string()))?;
    fs::create_dir_all(parent)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::Invalid("文件名不是有效 UTF-8".to_string()))?;
    let temporary = parent.join(format!(".{file_name}.yuling-tmp"));
    let mut file = File::create(&temporary)?;
    file.write_all(content)?;
    file.sync_all()?;
    fs::rename(&temporary, path)?;
    Ok(())
}

#[tauri::command]
pub fn authorize_workspace(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
    path: String,
) -> AppResult<String> {
    authorize_directory(&app, &state, &PathBuf::from(path))
}

#[tauri::command]
pub async fn list_documents(
    state: State<'_, WorkspaceState>,
    workspace: String,
) -> AppResult<Vec<DocumentEntry>> {
    let workspace_path = PathBuf::from(workspace);
    let root = authorized_root(&state, &workspace_path)?;
    tauri::async_runtime::spawn_blocking(move || list_documents_at(&root))
        .await
        .map_err(|error| AppError::Invalid(format!("文档扫描任务失败：{error}")))?
}

fn list_documents_at(root: &Path) -> AppResult<Vec<DocumentEntry>> {
    let mut entries = Vec::new();
    for item in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = item.path();
        if !item.file_type().is_file()
            || path.extension().and_then(|value| value.to_str()) != Some("md")
        {
            continue;
        }
        if path
            .components()
            .any(|part| part.as_os_str() == ".yulingmd")
        {
            continue;
        }
        let relative = path.strip_prefix(root).unwrap_or(path);
        entries.push(DocumentEntry {
            path: path.to_string_lossy().into_owned(),
            relative_path: relative.to_string_lossy().into_owned(),
            title: path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            modified_ms: modified_ms(path)?,
        });
    }
    entries.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(entries)
}

#[tauri::command]
pub async fn list_directories(
    state: State<'_, WorkspaceState>,
    workspace: String,
) -> AppResult<Vec<String>> {
    let root = authorized_root(&state, &PathBuf::from(workspace))?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut directories = WalkDir::new(&root)
            .follow_links(false)
            .min_depth(1)
            .into_iter()
            .filter_entry(|entry| entry.file_name() != ".yulingmd")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_dir())
            .filter_map(|entry| {
                entry
                    .path()
                    .strip_prefix(&root)
                    .ok()
                    .map(|path| path.to_string_lossy().replace('\\', "/"))
            })
            .collect::<Vec<_>>();
        directories.sort();
        Ok(directories)
    })
    .await
    .map_err(|error| AppError::Invalid(format!("目录扫描任务失败：{error}")))?
}

#[tauri::command]
pub fn read_document(state: State<'_, WorkspaceState>, path: String) -> AppResult<DocumentContent> {
    let path = PathBuf::from(path);
    authorized_root(&state, &path)?;
    Ok(DocumentContent {
        content: fs::read_to_string(&path)?,
        modified_ms: modified_ms(&path)?,
    })
}

#[tauri::command]
pub fn write_document(
    state: State<'_, WorkspaceState>,
    path: String,
    content: String,
    expected_modified_ms: Option<u64>,
) -> AppResult<u64> {
    let path = PathBuf::from(path);
    authorized_root(&state, &path)?;
    if let (Some(expected), Ok(current)) = (expected_modified_ms, modified_ms(&path)) {
        if expected != current {
            return Err(AppError::Conflict(path.display().to_string()));
        }
    }
    atomic_write(&path, content.as_bytes())?;
    modified_ms(&path)
}

#[tauri::command]
pub fn create_document(
    state: State<'_, WorkspaceState>,
    workspace: String,
    relative_path: String,
) -> AppResult<String> {
    let root = authorized_root(&state, &PathBuf::from(workspace))?;
    let path = create_document_at(&root, &relative_path)?;
    Ok(path.to_string_lossy().into_owned())
}

fn create_document_at(root: &Path, relative_path: &str) -> AppResult<PathBuf> {
    let requested = if relative_path.ends_with(".md") {
        relative_path.to_string()
    } else {
        format!("{relative_path}.md")
    };
    let root = root.canonicalize()?;
    let relative = validate_markdown_relative_path(&requested)?;
    let path = root.join(relative);
    if path.exists() {
        return Err(AppError::Invalid("文档已经存在".to_string()));
    }
    let mut existing_parent = path
        .parent()
        .ok_or_else(|| AppError::Invalid("文档没有父目录".to_string()))?;
    while !existing_parent.exists() {
        existing_parent = existing_parent
            .parent()
            .ok_or_else(|| AppError::Invalid("文档路径不能离开工作区".to_string()))?;
    }
    if !existing_parent.canonicalize()?.starts_with(&root) {
        return Err(AppError::Unauthorized(path.display().to_string()));
    }
    atomic_write(&path, b"")?;
    Ok(path)
}

fn move_document_at(
    root: &Path,
    source_relative_path: &str,
    destination_relative_path: &str,
) -> AppResult<DocumentEntry> {
    let source = existing_markdown_path(root, source_relative_path)?;
    let destination = available_markdown_destination(root, destination_relative_path)?;
    fs::rename(source, &destination)?;
    document_entry(root, &destination)
}

fn duplicate_document_at(
    root: &Path,
    source_relative_path: &str,
    destination_relative_path: &str,
) -> AppResult<DocumentEntry> {
    let source = existing_markdown_path(root, source_relative_path)?;
    let destination = available_markdown_destination(root, destination_relative_path)?;
    atomic_write(&destination, &fs::read(source)?)?;
    document_entry(root, &destination)
}

fn trash_document_at(
    root: &Path,
    relative_path: &str,
    delete: impl FnOnce(&Path) -> Result<(), String>,
) -> AppResult<()> {
    let source = existing_markdown_path(root, relative_path)?;
    delete(&source).map_err(|error| AppError::Invalid(format!("无法移入废纸篓：{error}")))
}

#[tauri::command]
pub fn move_document(
    state: State<'_, WorkspaceState>,
    workspace: String,
    source_relative_path: String,
    destination_relative_path: String,
) -> AppResult<DocumentEntry> {
    let root = authorized_root(&state, &PathBuf::from(workspace))?;
    move_document_at(&root, &source_relative_path, &destination_relative_path)
}

#[tauri::command]
pub fn duplicate_document(
    state: State<'_, WorkspaceState>,
    workspace: String,
    source_relative_path: String,
    destination_relative_path: String,
) -> AppResult<DocumentEntry> {
    let root = authorized_root(&state, &PathBuf::from(workspace))?;
    duplicate_document_at(&root, &source_relative_path, &destination_relative_path)
}

#[tauri::command]
pub fn create_directory(
    state: State<'_, WorkspaceState>,
    workspace: String,
    relative_path: String,
) -> AppResult<()> {
    let root = authorized_root(&state, &PathBuf::from(workspace))?;
    let destination = root.join(validate_directory_relative_path(&relative_path)?);
    if destination.exists() {
        return Err(AppError::Invalid("目录已经存在".to_string()));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::Invalid("目录没有父级".to_string()))?
        .canonicalize()?;
    if !parent.starts_with(&root) {
        return Err(AppError::Unauthorized(parent.display().to_string()));
    }
    fs::create_dir(destination)?;
    Ok(())
}

#[tauri::command]
pub fn move_directory(
    state: State<'_, WorkspaceState>,
    workspace: String,
    source_relative_path: String,
    destination_relative_path: String,
) -> AppResult<()> {
    let root = authorized_root(&state, &PathBuf::from(workspace))?;
    let source = existing_directory_path(&root, &source_relative_path)?;
    let destination = root.join(validate_directory_relative_path(
        &destination_relative_path,
    )?);
    if destination.exists() || destination.starts_with(&source) {
        return Err(AppError::Invalid(
            "不能覆盖目录或把目录移入自身".to_string(),
        ));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::Invalid("目标目录没有父级".to_string()))?
        .canonicalize()?;
    if !parent.starts_with(&root) {
        return Err(AppError::Unauthorized(parent.display().to_string()));
    }
    fs::rename(source, destination)?;
    Ok(())
}

#[tauri::command]
pub fn trash_directory(
    state: State<'_, WorkspaceState>,
    workspace: String,
    relative_path: String,
) -> AppResult<()> {
    let root = authorized_root(&state, &PathBuf::from(workspace))?;
    let directory = existing_directory_path(&root, &relative_path)?;
    trash::delete(directory).map_err(|error| AppError::Invalid(format!("无法移入废纸篓：{error}")))
}

#[tauri::command]
pub fn reveal_document_in_finder(
    state: State<'_, WorkspaceState>,
    workspace: String,
    relative_path: String,
) -> AppResult<()> {
    let root = authorized_root(&state, &PathBuf::from(workspace))?;
    let path = existing_markdown_path(&root, &relative_path)?;
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("/usr/bin/open")
            .arg("-R")
            .arg(path)
            .status()
            .map_err(|error| AppError::Invalid(format!("无法在访达中显示：{error}")))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    Err(AppError::Invalid("当前仅支持 macOS 访达".to_string()))
}

#[tauri::command]
pub fn trash_document(
    state: State<'_, WorkspaceState>,
    workspace: String,
    relative_path: String,
) -> AppResult<()> {
    let root = authorized_root(&state, &PathBuf::from(workspace))?;
    trash_document_at(&root, &relative_path, |source| {
        trash::delete(source).map_err(|error| error.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::{
        atomic_write, create_document_at, duplicate_document_at, move_document_at,
        trash_document_at,
    };
    use tempfile::tempdir;

    #[test]
    fn atomic_write_replaces_existing_content() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("note.md");
        atomic_write(&path, b"first").unwrap();
        atomic_write(&path, b"second").unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), "second");
    }

    #[test]
    fn creates_a_truly_blank_document_without_overwriting() {
        let directory = tempdir().unwrap();
        let path = create_document_at(directory.path(), "项目/未命名.md").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"");
        assert!(create_document_at(directory.path(), "项目/未命名.md").is_err());
    }

    #[test]
    fn moves_markdown_without_overwriting() {
        let directory = tempdir().unwrap();
        std::fs::create_dir(directory.path().join("归档")).unwrap();
        std::fs::write(directory.path().join("原文.md"), "内容").unwrap();
        let moved = move_document_at(directory.path(), "原文.md", "归档/新名字.md").unwrap();
        assert_eq!(moved.relative_path, "归档/新名字.md");
        assert_eq!(
            std::fs::read_to_string(directory.path().join("归档/新名字.md")).unwrap(),
            "内容"
        );

        std::fs::write(directory.path().join("另一个.md"), "另一个").unwrap();
        assert!(move_document_at(directory.path(), "另一个.md", "归档/新名字.md").is_err());
        assert_eq!(
            std::fs::read_to_string(directory.path().join("另一个.md")).unwrap(),
            "另一个"
        );
    }

    #[test]
    fn duplicates_markdown_without_overwriting_the_source_or_target() {
        let directory = tempdir().unwrap();
        std::fs::write(directory.path().join("原文.md"), "内容").unwrap();
        let copied = duplicate_document_at(directory.path(), "原文.md", "原文 副本.md").unwrap();
        assert_eq!(copied.relative_path, "原文 副本.md");
        assert_eq!(
            std::fs::read_to_string(directory.path().join("原文.md")).unwrap(),
            "内容"
        );
        assert!(duplicate_document_at(directory.path(), "原文.md", "原文 副本.md").is_err());
    }

    #[test]
    fn rejects_escaping_and_hidden_directory_paths() {
        assert!(super::validate_directory_relative_path("项目/子目录").is_ok());
        assert!(super::validate_directory_relative_path("../逃逸").is_err());
        assert!(super::validate_directory_relative_path(".yulingmd/内部").is_err());
        assert!(super::validate_directory_relative_path("").is_err());
    }

    #[test]
    fn rejects_paths_outside_the_workspace_and_non_markdown_files() {
        let directory = tempdir().unwrap();
        std::fs::write(directory.path().join("安全.md"), "内容").unwrap();
        assert!(move_document_at(directory.path(), "../安全.md", "新.md").is_err());
        assert!(move_document_at(directory.path(), "安全.md", "../逃逸.md").is_err());
        assert!(move_document_at(directory.path(), "安全.md", "文件.txt").is_err());
        assert!(move_document_at(directory.path(), "安全.md", ".yulingmd/隐藏.md").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlink_that_escapes_the_workspace() {
        use std::os::unix::fs::symlink;
        let directory = tempdir().unwrap();
        let outside = tempdir().unwrap();
        std::fs::write(outside.path().join("秘密.md"), "秘密").unwrap();
        symlink(
            outside.path().join("秘密.md"),
            directory.path().join("链接.md"),
        )
        .unwrap();
        assert!(move_document_at(directory.path(), "链接.md", "移动.md").is_err());
    }

    #[test]
    fn invokes_the_trash_adapter_for_the_validated_document() {
        let directory = tempdir().unwrap();
        let document = directory.path().join("待删除.md");
        std::fs::write(&document, "内容").unwrap();
        let called = std::cell::Cell::new(false);
        trash_document_at(directory.path(), "待删除.md", |path| {
            called.set(true);
            assert_eq!(path, document.canonicalize().unwrap());
            std::fs::remove_file(path).map_err(|error| error.to_string())
        })
        .unwrap();
        assert!(called.get());
        assert!(!document.exists());
    }
}
