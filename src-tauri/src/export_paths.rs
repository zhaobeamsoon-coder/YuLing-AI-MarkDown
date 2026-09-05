use crate::error::{AppError, AppResult};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct ExportState {
    selected: Mutex<HashSet<PathBuf>>,
}

fn normalized_destination(path: &Path) -> AppResult<PathBuf> {
    if !path.is_absolute() {
        return Err(AppError::Invalid("导出路径必须是绝对路径".to_string()));
    }
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Invalid("导出路径没有父目录".to_string()))?
        .canonicalize()?;
    let name = path
        .file_name()
        .ok_or_else(|| AppError::Invalid("导出路径没有文件名".to_string()))?;
    Ok(parent.join(name))
}

fn is_numbered_image(selected: &Path, candidate: &Path) -> bool {
    if selected.parent() != candidate.parent() || selected.extension() != candidate.extension() {
        return false;
    }
    let Some(stem) = selected.file_stem().and_then(|value| value.to_str()) else { return false };
    let Some(candidate_stem) = candidate.file_stem().and_then(|value| value.to_str()) else { return false };
    candidate_stem
        .strip_prefix(&format!("{stem}-"))
        .is_some_and(|suffix| !suffix.is_empty() && suffix.chars().all(|character| character.is_ascii_digit()))
}

fn is_pdf_part(selected: &Path, candidate: &Path) -> bool {
    if selected.parent() != candidate.parent() {
        return false;
    }
    let Some(name) = selected.file_name().and_then(|value| value.to_str()) else { return false };
    let Some(candidate_name) = candidate.file_name().and_then(|value| value.to_str()) else { return false };
    candidate_name
        .strip_prefix(&format!("{name}.yuling-page-"))
        .and_then(|suffix| suffix.strip_suffix(".pdf"))
        .is_some_and(|number| !number.is_empty() && number.chars().all(|character| character.is_ascii_digit()))
}

impl ExportState {
    pub(crate) fn authorize(&self, path: &Path) -> AppResult<PathBuf> {
        let normalized = normalized_destination(path)?;
        self.selected.lock().expect("export paths mutex poisoned").insert(normalized.clone());
        Ok(normalized)
    }

    pub fn ensure_authorized(&self, path: &Path) -> AppResult<PathBuf> {
        let candidate = normalized_destination(path)?;
        let selected = self.selected.lock().expect("export paths mutex poisoned");
        if selected.iter().any(|destination| {
            candidate == *destination || is_pdf_part(destination, &candidate) || is_numbered_image(destination, &candidate)
        }) {
            Ok(candidate)
        } else {
            Err(AppError::Unauthorized(candidate.display().to_string()))
        }
    }
}

#[tauri::command]
pub async fn choose_export_path(
    app: AppHandle,
    state: State<'_, ExportState>,
    default_name: String,
    kind: String,
) -> AppResult<Option<String>> {
    let (label, extension, title) = match kind.as_str() {
        "pdf" => ("PDF", "pdf", "导出 PDF"),
        "png" => ("PNG", "png", "导出长图"),
        "html" => ("HTML", "html", "导出 HTML"),
        _ => return Err(AppError::Invalid("不支持的导出类型".to_string())),
    };
    let file = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title(title)
            .set_file_name(default_name)
            .add_filter(label, &[extension])
            .blocking_save_file()
    })
    .await
    .map_err(|error| AppError::Invalid(error.to_string()))?;
    let Some(file) = file else { return Ok(None) };
    let mut path = file
        .into_path()
        .map_err(|_| AppError::Invalid("所选位置不是本地文件路径".to_string()))?;
    if path.extension().is_none() {
        path.set_extension(extension);
    }
    if path.extension().and_then(|value| value.to_str()).map(str::to_ascii_lowercase).as_deref() != Some(extension) {
        return Err(AppError::Invalid(format!("请选择 .{extension} 文件")));
    }
    let authorized = state.authorize(&path)?;
    Ok(Some(authorized.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::ExportState;
    use tempfile::tempdir;

    #[test]
    fn only_allows_selected_destination_and_its_deterministic_parts() {
        let directory = tempdir().unwrap();
        let state = ExportState::default();
        let pdf = directory.path().join("文档.pdf");
        state.authorize(&pdf).unwrap();
        assert!(state.ensure_authorized(&pdf).is_ok());
        assert!(state.ensure_authorized(&directory.path().join("文档.pdf.yuling-page-2.pdf")).is_ok());
        assert!(state.ensure_authorized(&directory.path().join("其他.pdf")).is_err());

        let image = directory.path().join("长图.png");
        state.authorize(&image).unwrap();
        assert!(state.ensure_authorized(&directory.path().join("长图-03.png")).is_ok());
        assert!(state.ensure_authorized(&directory.path().join("长图-secret.png")).is_err());
    }
}
