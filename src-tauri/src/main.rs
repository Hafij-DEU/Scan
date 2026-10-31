// No console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, UNIX_EPOCH};

use percent_encoding::percent_decode_str;
use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::webview::{NewWindowResponse, PermissionKind, PermissionResponse};
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

/// The folder exports are written to and listed from, and the OAuth loopback listener.
struct AppState {
    folder: Mutex<PathBuf>,
    settings_file: PathBuf,
    oauth: Mutex<Option<TcpListener>>,
}

#[derive(Serialize)]
struct FileEntry {
    name: String,
    size: u64,
    /// Last modification, milliseconds since the Unix epoch.
    modified: u64,
}

/// Default folder: Documents/DocScan (falls back to the home folder when there is no Documents).
fn default_folder(app: &tauri::App) -> PathBuf {
    let paths = app.path();
    paths
        .document_dir()
        .or_else(|_| paths.home_dir())
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("DocScan")
}

fn folder(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    let dir = state.folder.lock().map_err(|e| e.to_string())?.clone();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// A plain file name inside the folder: no separators, no parent references.
fn entry(state: &State<'_, AppState>, name: &str) -> Result<PathBuf, String> {
    let bad = name.is_empty()
        || name == "."
        || name == ".."
        || name.chars().any(|c| matches!(c, '/' | '\\' | ':' | '\0'));
    if bad {
        return Err(format!("Invalid file name: {name}"));
    }
    Ok(folder(state)?.join(name))
}

fn header(request: &Request<'_>, key: &str) -> Option<String> {
    request
        .headers()
        .get(key)
        .and_then(|v| v.to_str().ok())
        .map(|v| percent_decode_str(v).decode_utf8_lossy().into_owned())
}

#[tauri::command]
fn folder_path(state: State<'_, AppState>) -> Result<String, String> {
    Ok(folder(&state)?.display().to_string())
}

/// Lets the user pick another folder; returns its path, or an empty string when cancelled.
#[tauri::command]
async fn choose_folder(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let start = folder(&state)?;
    // Async command: runs off the main thread, so the blocking dialog cannot deadlock it.
    let Some(picked) = app.dialog().file().set_directory(&start).blocking_pick_folder() else {
        return Ok(String::new());
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&state.settings_file, path.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
    *state.folder.lock().map_err(|e| e.to_string())? = path.clone();
    Ok(path.display().to_string())
}

/// PDFs directly inside the folder (not in subfolders).
#[tauri::command]
fn list_pdfs(state: State<'_, AppState>) -> Result<Vec<FileEntry>, String> {
    let mut out = Vec::new();
    for item in std::fs::read_dir(folder(&state)?).map_err(|e| e.to_string())? {
        let Ok(item) = item else { continue };
        let name = item.file_name().to_string_lossy().into_owned();
        if !name.to_ascii_lowercase().ends_with(".pdf") || name.starts_with('.') {
            continue;
        }
        let Ok(meta) = item.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as u64);
        out.push(FileEntry { name, size: meta.len(), modified });
    }
    Ok(out)
}

/// Raw file bytes; `max` reads only the start of the file (thumbnails).
#[tauri::command]
fn read_file(state: State<'_, AppState>, name: String, max: Option<u64>) -> Result<Response, String> {
    let path = entry(&state, &name)?;
    let bytes = match max {
        Some(limit) => {
            let mut buf = Vec::new();
            std::fs::File::open(&path)
                .and_then(|f| f.take(limit).read_to_end(&mut buf))
                .map_err(|e| e.to_string())?;
            buf
        }
        None => std::fs::read(&path).map_err(|e| e.to_string())?,
    };
    Ok(Response::new(bytes))
}

/// Writes the raw request body to the folder under the URI-encoded `x-file-name`.
/// Fails with "exists" when the file is there and `x-overwrite` is not "1".
/// Returns the full path.
#[tauri::command]
fn write_file(state: State<'_, AppState>, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file as raw bytes".into());
    };
    let name = header(&request, "x-file-name").unwrap_or_default();
    let path = entry(&state, &name)?;
    if path.exists() && header(&request, "x-overwrite").as_deref() != Some("1") {
        return Err("exists".into());
    }
    // Write next to the target, then rename: a reader never sees half a file.
    let part = path.with_file_name(format!(".{name}.part"));
    std::fs::write(&part, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&part, &path).map_err(|e| {
        let _ = std::fs::remove_file(&part);
        e.to_string()
    })?;
    Ok(path.display().to_string())
}

#[tauri::command]
fn file_exists(state: State<'_, AppState>, name: String) -> Result<bool, String> {
    Ok(entry(&state, &name)?.exists())
}

#[tauri::command]
fn delete_file(state: State<'_, AppState>, name: String) -> Result<(), String> {
    std::fs::remove_file(entry(&state, &name)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_file(state: State<'_, AppState>, from: String, to: String) -> Result<(), String> {
    let target = entry(&state, &to)?;
    if target.exists() {
        return Err(format!("{to} already exists"));
    }
    std::fs::rename(entry(&state, &from)?, target).map_err(|e| e.to_string())
}

/// Opens a file from the folder in the system's default app (PDF viewer).
#[tauri::command]
fn open_file(state: State<'_, AppState>, name: String) -> Result<(), String> {
    open::that_detached(entry(&state, &name)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_folder(state: State<'_, AppState>) -> Result<(), String> {
    open::that_detached(folder(&state)?).map_err(|e| e.to_string())
}

/// Opens a web page (Google sign-in) in the system browser.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("only https links can be opened".into());
    }
    open::that_detached(url).map_err(|e| e.to_string())
}

/// Starts the OAuth loopback listener on a free local port and returns the port.
#[tauri::command]
fn oauth_listen(state: State<'_, AppState>) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    *state.oauth.lock().map_err(|e| e.to_string())? = Some(listener);
    Ok(port)
}

/// Waits (up to five minutes) for the browser to come back to the loopback
/// address and returns the query string of that request (code, state or error).
#[tauri::command]
async fn oauth_wait(state: State<'_, AppState>) -> Result<String, String> {
    let listener = state
        .oauth
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or("sign-in was not started")?;
    tauri::async_runtime::spawn_blocking(move || wait_for_redirect(&listener))
        .await
        .map_err(|e| e.to_string())?
}

fn wait_for_redirect(listener: &TcpListener) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(300);
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(query) = answer_redirect(stream) {
                    return Ok(query);
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(150)),
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("Sign-in timed out".into())
}

/// Reads one HTTP request. Returns its query string when it is the redirect
/// (has a query), after telling the browser it can go back to the app.
fn answer_redirect(mut stream: TcpStream) -> Option<String> {
    stream.set_nonblocking(false).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).ok()?;
    let head = String::from_utf8_lossy(&buf[..n]);
    let target = head.lines().next()?.split_whitespace().nth(1)?.to_string();
    let query = target.split_once('?').map(|(_, q)| q.to_string());
    let body = if query.is_some() {
        "<!doctype html><meta charset=utf-8><title>DocScan</title><body style=\"font-family:system-ui;text-align:center;padding:48px\"><h2>Signed in</h2><p>You can close this tab and go back to DocScan.</p>"
    } else {
        ""
    };
    let status = if query.is_some() { "200 OK" } else { "404 Not Found" };
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    query
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            folder_path,
            choose_folder,
            list_pdfs,
            read_file,
            write_file,
            file_exists,
            delete_file,
            rename_file,
            open_file,
            reveal_folder,
            open_url,
            oauth_listen,
            oauth_wait
        ])
        .setup(|app| {
            let config = app.path().app_config_dir()?;
            std::fs::create_dir_all(&config)?;
            let settings_file = config.join("folder.txt");
            let folder = std::fs::read_to_string(&settings_file)
                .ok()
                .map(|s| PathBuf::from(s.trim()))
                .filter(|p| p.is_absolute() && Path::new(p).is_dir())
                .unwrap_or_else(|| default_folder(app));
            app.manage(AppState { folder: Mutex::new(folder), settings_file, oauth: Mutex::new(None) });

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
