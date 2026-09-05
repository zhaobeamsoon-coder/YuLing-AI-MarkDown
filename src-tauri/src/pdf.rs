use crate::error::{AppError, AppResult};
use crate::export_paths::ExportState;

#[cfg(target_os = "macos")]
use std::path::PathBuf;
#[cfg(target_os = "macos")]
use std::sync::mpsc;
#[cfg(target_os = "macos")]
use std::time::Duration;
#[cfg(target_os = "macos")]
use tauri::{State, WebviewWindow};

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn capture_pdf_page(
    window: WebviewWindow,
    state: State<'_, ExportState>,
    output_path: String,
    width: f64,
    height: f64,
) -> AppResult<()> {
    if !(100.0..=5000.0).contains(&width) || !(100.0..=8000.0).contains(&height) {
        return Err(AppError::Invalid("PDF 页面尺寸不合法".to_string()));
    }
    let destination = state.ensure_authorized(&PathBuf::from(output_path))?;
    let (sender, receiver) = mpsc::channel::<Result<Vec<u8>, String>>();
    window
        .with_webview(move |platform_webview| unsafe {
            use block2::RcBlock;
            use objc2::MainThreadMarker;
            use objc2_core_foundation::{CGPoint, CGRect, CGSize};
            use objc2_foundation::{NSData, NSError};
            use objc2_web_kit::{WKPDFConfiguration, WKWebView};

            let view = &*(platform_webview.inner() as *mut WKWebView);
            let marker = MainThreadMarker::new().expect("Tauri with_webview runs on main thread");
            let configuration = WKPDFConfiguration::new(marker);
            configuration.setRect(CGRect::new(CGPoint::ZERO, CGSize::new(width, height)));
            let callback = RcBlock::new(move |pdf: *mut NSData, error: *mut NSError| {
                let result = if !error.is_null() || pdf.is_null() {
                    Err("WebKit 无法生成此页面的 PDF".to_string())
                } else {
                    Ok((&*pdf).to_vec())
                };
                let _ = sender.send(result);
            });
            view.createPDFWithConfiguration_completionHandler(Some(&configuration), &callback);
        })
        .map_err(|error| AppError::Invalid(error.to_string()))?;

    let bytes = tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(Duration::from_secs(30)))
        .await
        .map_err(|error| AppError::Invalid(error.to_string()))?
        .map_err(|_| AppError::Invalid("PDF 页面生成超时".to_string()))?
        .map_err(AppError::Invalid)?;
    std::fs::write(destination, bytes)?;
    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn merge_pdf_pages(state: State<'_, ExportState>, page_paths: Vec<String>, output_path: String) -> AppResult<usize> {
    use objc2::AnyThread;
    use objc2_foundation::{NSData, NSString};
    use objc2_pdf_kit::PDFDocument;

    if page_paths.is_empty() || page_paths.len() > 200 {
        return Err(AppError::Invalid("PDF 页数必须在 1 到 200 之间".to_string()));
    }
    let output_path = state.ensure_authorized(&PathBuf::from(output_path))?;
    let output = unsafe { PDFDocument::new() };
    let mut inserted = 0;
    for path in &page_paths {
        let authorized = state.ensure_authorized(&PathBuf::from(path))?;
        let bytes = std::fs::read(&authorized)?;
        let page_data = NSData::with_bytes(&bytes);
        let source = unsafe { PDFDocument::initWithData(PDFDocument::alloc(), &page_data) }
            .ok_or_else(|| AppError::Invalid(format!("无法读取 PDF 页面：{path}")))?;
        let count = unsafe { source.pageCount() };
        for index in 0..count {
            let page = unsafe { source.pageAtIndex(index) }
                .ok_or_else(|| AppError::Invalid(format!("PDF 页面缺失：{path}")))?;
            unsafe { output.insertPage_atIndex(&page, inserted) };
            inserted += 1;
        }
    }
    let destination = NSString::from_str(&output_path.to_string_lossy());
    if !unsafe { output.writeToFile(&destination) } {
        return Err(AppError::Invalid("PDF 合并写入失败".to_string()));
    }
    for path in page_paths {
        let _ = std::fs::remove_file(path);
    }
    Ok(inserted)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn capture_pdf_page(
    _window: tauri::WebviewWindow,
    _state: tauri::State<'_, ExportState>,
    _output_path: String,
    _width: f64,
    _height: f64,
) -> AppResult<()> {
    Err(AppError::Invalid("直接 PDF 导出目前仅支持 macOS".to_string()))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn merge_pdf_pages(_state: tauri::State<'_, ExportState>, _page_paths: Vec<String>, _output_path: String) -> AppResult<usize> {
    Err(AppError::Invalid("直接 PDF 导出目前仅支持 macOS".to_string()))
}
