use crate::error::{AppError, AppResult};
use crate::workspace::WorkspaceState;
use chrono::Utc;
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeCardInput {
    pub title: String,
    pub summary: String,
    pub concepts: Vec<String>,
    pub source_document: String,
    pub source_excerpt: String,
    pub related_documents: Vec<String>,
}

fn safe_slug(title: &str) -> String {
    let slug: String = title
        .chars()
        .filter(|character| character.is_alphanumeric() || matches!(character, '-' | '_'))
        .take(48)
        .collect();
    if slug.is_empty() {
        "知识卡片".to_string()
    } else {
        slug
    }
}

fn escape_yaml(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', " ")
}

pub fn render_card(card: &KnowledgeCardInput, created_at: &str) -> String {
    let concepts = card
        .concepts
        .iter()
        .map(|concept| format!("  - \"{}\"", escape_yaml(concept)))
        .collect::<Vec<_>>()
        .join("\n");
    let related = card
        .related_documents
        .iter()
        .map(|path| format!("- [[{}]]", path))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "---\nyulingCardVersion: 1\ntitle: \"{}\"\ncreatedAt: \"{}\"\nsource: \"{}\"\nconcepts:\n{}\n---\n\n# {}\n\n{}\n\n## 原文\n\n> {}\n\n## 关联文档\n\n{}\n",
        escape_yaml(&card.title),
        created_at,
        escape_yaml(&card.source_document),
        concepts,
        card.title,
        card.summary,
        card.source_excerpt.replace('\n', "\n> "),
        if related.is_empty() { "暂无" } else { &related },
    )
}

fn available_card_path(directory: &Path, stem: &str) -> PathBuf {
    let initial = directory.join(format!("{stem}.md"));
    if !initial.exists() {
        return initial;
    }
    for suffix in 2..=10_000 {
        let candidate = directory.join(format!("{stem}-{suffix}.md"));
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{stem}-{}.md", Utc::now().timestamp_micros()))
}

#[tauri::command]
pub fn save_knowledge_card(
    state: State<'_, WorkspaceState>,
    workspace: String,
    card: KnowledgeCardInput,
) -> AppResult<String> {
    if card.title.trim().is_empty() || card.summary.trim().is_empty() {
        return Err(AppError::Invalid("知识卡片缺少标题或内容".to_string()));
    }
    let workspace_path = state.authorized_root(&PathBuf::from(workspace))?;
    let now = Utc::now();
    let directory = workspace_path.join("知识卡片");
    fs::create_dir_all(&directory)?;
    let stem = format!("{}-{}", now.format("%Y%m%d-%H%M%S"), safe_slug(&card.title));
    let path = available_card_path(&directory, &stem);
    crate::workspace::atomic_write(&path, render_card(&card, &now.to_rfc3339()).as_bytes())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::{available_card_path, render_card, KnowledgeCardInput};
    use std::fs;

    #[test]
    fn renders_portable_markdown_card() {
        let markdown = render_card(
            &KnowledgeCardInput {
                title: "压强".to_string(),
                summary: "单位面积上的力。".to_string(),
                concepts: vec!["物理".to_string()],
                source_document: "notes/a.md".to_string(),
                source_excerpt: "什么是压强？".to_string(),
                related_documents: vec!["notes/b.md".to_string()],
            },
            "2026-08-24T00:00:00Z",
        );
        assert!(markdown.contains("yulingCardVersion: 1"));
        assert!(markdown.contains("[[notes/b.md]]"));
    }

    #[test]
    fn never_reuses_a_card_path() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("stamp-title.md"), "first").unwrap();
        assert_eq!(
            available_card_path(directory.path(), "stamp-title"),
            directory.path().join("stamp-title-2.md")
        );
    }
}
