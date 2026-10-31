// No console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request};
use tauri::webview::{NewWindowResponse, PermissionKind, PermissionResponse};
use tauri::{WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

/// Asks where to save an export and writes it there. The file bytes are the raw
/// request body and the suggested name is the URI-encoded `x-file-name` header.
/// Returns the saved path, or an empty string when the user cancels.
#[tauri::command]
async fn save_file(app: tauri::AppHandle, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file as raw bytes".into());
    };
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .map(|v| percent_decode_str(v).decode_utf8_lossy().into_owned())
        .unwrap_or_else(|| "export".into());
    let mut dialog = app.dialog().file().set_file_name(&name);
    match name.rsplit_once('.').map(|(_, ext)| ext.to_ascii_lowercase()) {
        Some(ext) if ext == "pdf" => dialog = dialog.add_filter("PDF document", &["pdf"]),
        Some(ext) if ext == "jpg" || ext == "jpeg" => dialog = dialog.add_filter("JPEG image", &["jpg", "jpeg"]),
        _ => {}
    }
    // Async command: runs off the main thread, so the blocking dialog cannot deadlock it.
    let Some(path) = dialog.blocking_save_file() else {
        return Ok(String::new());
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_file])
        .setup(|app| {
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("DocScan")
                .inner_size(1100.0, 820.0)
                .min_inner_size(360.0, 560.0)
                // The page only needs the camera.
                .on_permission_request(|_, kind| match kind {
                    PermissionKind::Camera => PermissionResponse::Allow,
                    _ => PermissionResponse::Deny,
                })
                // Links (About screen) open in the system browser, never inside the app.
                .on_new_window(|url, _| {
                    if url.scheme() == "https" {
                        let _ = open::that_detached(url.as_str());
                    }
                    NewWindowResponse::Deny
                })
                .build()?;
            // WebKitGTK ships with getUserMedia switched off.
            #[cfg(target_os = "linux")]
            window.with_webview(|webview| {
                use webkit2gtk::{SettingsExt, WebViewExt};
                if let Some(settings) = webview.inner().settings() {
                    settings.set_enable_media_stream(true);
                }
            })?;
            #[cfg(not(target_os = "linux"))]
            let _ = window;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running DocScan");
}
