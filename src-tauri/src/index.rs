use crate::error::{AppError, AppResult};
use crate::workspace::WorkspaceState;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use walkdir::WalkDir;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub path: String,
    pub title: String,
    pub excerpt: String,
    pub score: f64,
}

fn database(app: &AppHandle) -> AppResult<Connection> {
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| AppError::Invalid(error.to_string()))?;
    fs::create_dir_all(&directory)?;
    let connection = Connection::open(directory.join("workspace-index.sqlite3"))?;
    connection.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(\
         path UNINDEXED, workspace UNINDEXED, title, content, tokenize='unicode61');",
    )?;
    Ok(connection)
}

fn markdown_files(root: &Path) -> Vec<PathBuf> {
    WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_file()
                && entry.path().extension().and_then(|value| value.to_str()) == Some("md")
                && !entry
                    .path()
                    .components()
                    .any(|part| part.as_os_str() == ".yulingmd")
        })
        .map(|entry| entry.into_path())
        .collect()
}

#[tauri::command]
pub async fn index_workspace(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
    workspace: String,
) -> AppResult<usize> {
    let root = state.authorized_root(&PathBuf::from(workspace))?;
    tauri::async_runtime::spawn_blocking(move || index_workspace_at(&app, &root))
        .await
        .map_err(|error| AppError::Invalid(format!("索引任务失败：{error}")))?
}

fn index_workspace_at(app: &AppHandle, root: &Path) -> AppResult<usize> {
    let mut connection = database(app)?;
    let transaction = connection.transaction()?;
    transaction.execute(
        "DELETE FROM documents_fts WHERE workspace = ?1",
        params![root.to_string_lossy()],
    )?;
    let mut count = 0;
    for path in markdown_files(root) {
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let title = content
            .lines()
            .find_map(|line| line.strip_prefix("# "))
            .filter(|title| !title.trim().is_empty())
            .map(str::to_owned)
            .or_else(|| {
                path.file_stem()
                    .map(|value| value.to_string_lossy().into_owned())
            })
            .unwrap_or_else(|| "未命名".to_string());
        transaction.execute(
            "INSERT INTO documents_fts(path, workspace, title, content) VALUES (?1, ?2, ?3, ?4)",
            params![
                path.to_string_lossy(),
                root.to_string_lossy(),
                title,
                content
            ],
        )?;
        count += 1;
    }
    transaction.commit()?;
    Ok(count)
}

fn fts_query(input: &str) -> AppResult<String> {
    let terms: Vec<String> = input
        .split_whitespace()
        .map(|term| term.replace('"', ""))
        .filter(|term| !term.is_empty())
        .take(12)
        .map(|term| format!("\"{term}\""))
        .collect();
    if terms.is_empty() {
        return Err(AppError::Invalid("请输入搜索内容".to_string()));
    }
    Ok(terms.join(" OR "))
}

#[tauri::command]
pub fn search_workspace(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
    workspace: String,
    query: String,
    limit: Option<usize>,
) -> AppResult<Vec<SearchResult>> {
    let root = state.authorized_root(&PathBuf::from(&workspace))?;
    let connection = database(&app)?;
    let expression = fts_query(&query)?;
    let mut statement = connection.prepare(
        "SELECT path, title, snippet(documents_fts, 3, '<mark>', '</mark>', '…', 24), bm25(documents_fts) \
         FROM documents_fts WHERE workspace = ?1 AND documents_fts MATCH ?2 ORDER BY bm25(documents_fts) LIMIT ?3",
    )?;
    let rows = statement.query_map(
        params![
            root.to_string_lossy(),
            expression,
            limit.unwrap_or(8).min(20) as i64
        ],
        |row| {
            Ok(SearchResult {
                path: row.get(0)?,
                title: row.get(1)?,
                excerpt: row.get(2)?,
                score: row.get(3)?,
            })
        },
    )?;
    Ok(rows.filter_map(Result::ok).collect())
}

#[cfg(test)]
mod tests {
    use super::fts_query;

    #[test]
    fn builds_safe_or_query() {
        assert_eq!(fts_query("中文 table").unwrap(), "\"中文\" OR \"table\"");
        assert!(fts_query("   ").is_err());
    }
}
