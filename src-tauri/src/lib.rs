mod ai;
mod ai_cli;
mod credentials;
mod error;
mod external;
mod export_paths;
mod index;
mod knowledge;
mod open_files;
mod pdf;
mod storage;
mod workspace;

pub fn run() {
    use tauri::{Emitter, Manager};

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(workspace::WorkspaceState::default())
        .manage(export_paths::ExportState::default())
        .manage(open_files::OpenFileState::default())
        .manage(ai::AiState::default())
        .invoke_handler(tauri::generate_handler![
            workspace::authorize_workspace,
            workspace::list_documents,
            workspace::list_directories,
            workspace::read_document,
            workspace::write_document,
            workspace::create_document,
            workspace::move_document,
            workspace::duplicate_document,
            workspace::reveal_document_in_finder,
            workspace::create_directory,
            workspace::move_directory,
            workspace::trash_directory,
            workspace::trash_document,
            workspace::import_asset,
            workspace::save_workspace_layout,
            workspace::load_workspace_layout,
            workspace::write_export_file,
            export_paths::choose_export_path,
            external::open_external_url,
            credentials::save_credential,
            credentials::has_credential,
            credentials::delete_credential,
            index::index_workspace,
            index::search_workspace,
            knowledge::save_knowledge_card,
            ai::ai_chat,
            ai::cancel_ai_chat,
            ai::test_ai_connection,
            ai_cli::probe_ai_cli,
            pdf::capture_pdf_page,
            pdf::merge_pdf_pages,
            storage::upload_assets,
            open_files::take_opened_markdown,
            open_files::choose_markdown_file,
            open_files::choose_markdown_save_path,
            open_files::write_markdown_copy,
        ])
        .build(tauri::generate_context!())
        .expect("error while building YuLing MD");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Opened { urls } = event {
            let state = app_handle.state::<open_files::OpenFileState>();
            open_files::queue_opened_urls(&state, &urls);
            let _ = app_handle.emit("yuling://opened-markdown", ());
        }
    });
}
