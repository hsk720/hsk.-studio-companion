//! hsk. studio: the photographer's panel on the desktop, with the folder that fills the album by itself.

mod api;
mod auth;
mod config;
mod keyring;
mod notify;
mod processor;
mod retouch;
mod tray;
mod uploader;
mod watcher;

use config::{Ledger, Mode, Settings};
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use uploader::Task;

pub struct AppState {
    pub http: reqwest::Client,
    pub settings: Mutex<Settings>,
    pub ledger: Ledger,
    pub watch: Mutex<Option<watcher::Watch>>,
    pub retouch: Mutex<Option<retouch::Active>>,
    pub queue: uploader::Queue,
    /// the last pairing code taken from a link, so the same link is not claimed twice
    pub last_code: Mutex<Option<String>>,
}

/// What the window needs to draw the folder section. The token is not part of it.
#[derive(Serialize)]
struct Setup {
    folder: Option<PathBuf>,
    album: Option<String>,
    album_name: String,
    mode: Mode,
    watching: bool,
}

fn setup_of(app: &AppHandle) -> Setup {
    let state = app.state::<AppState>();
    let watching = state.watch.lock().unwrap().is_some();
    let s = state.settings.lock().unwrap();
    Setup { folder: s.folder.clone(), album: s.album.clone(), album_name: s.album_name.clone(), mode: s.mode, watching }
}

fn send_all(app: &AppHandle, paths: Vec<PathBuf>, album: &str, mode: Mode) {
    let intake = app.state::<AppState>().queue.intake.clone();
    for path in paths {
        let _ = intake.send(Task { path, album: album.to_string(), mode });
    }
}

fn begin_watching(app: &AppHandle, include_existing: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let (folder, album, mode) = {
        let s = state.settings.lock().unwrap();
        (s.folder.clone().ok_or("Alege mai întâi folderul.")?, s.album.clone().ok_or("Alege mai întâi albumul.")?, s.mode)
    };
    let (tx, code) = (state.queue.intake.clone(), album.clone());
    let watch = watcher::start(&folder, move |path| {
        let _ = tx.send(Task { path, album: code.clone(), mode });
    })?;
    *state.watch.lock().unwrap() = Some(watch);
    if include_existing {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || send_all(&app, watcher::existing(&folder), &album, mode));
    }
    tray::status(app, "urmărește folderul");
    Ok(())
}

/// The window may only reach the album panel's API, never the billing or anything outside it.
fn allowed(path: &str) -> bool {
    (path.starts_with("/api/albums") || path.starts_with("/api/desktop"))
        && !path.contains("..")
        && !path.contains("//")
        && !path.contains('\\')
        && !path.contains("/billing")
}

#[tauri::command]
async fn api_call(app: AppHandle, method: String, path: String, body: Option<Value>) -> Result<Value, String> {
    if !allowed(&path) || !["GET", "POST", "PUT", "PATCH", "DELETE"].contains(&method.as_str()) {
        return Err("Cerere nepermisă.".into());
    }
    let token = keyring::load().ok_or("Aplicația nu este conectată la cont.")?;
    match api::request(&app.state::<AppState>().http, &token, &method, &path, body).await {
        Ok(v) => Ok(v),
        Err(api::ApiError::Unauthorized(m)) => {
            auth::drop_session(&app);
            Err(m)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn setup_get(app: AppHandle) -> Setup {
    setup_of(&app)
}

#[tauri::command]
async fn folder_pick(app: AppHandle) -> Option<PathBuf> {
    app.dialog().file().set_title("Folderul în care exporți pozele").blocking_pick_folder()?.into_path().ok()
}

#[tauri::command]
async fn files_pick(app: AppHandle) -> Vec<PathBuf> {
    app.dialog()
        .file()
        .set_title("Alege pozele")
        .add_filter("Poze", &processor::EXTENSIONS)
        .blocking_pick_files()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| p.into_path().ok())
        .collect()
}

/// Photos or folders dropped on the window, or chosen with the file dialog: folders are searched for photos.
#[tauri::command]
fn upload_paths(app: AppHandle, album: String, paths: Vec<PathBuf>, mode: Mode) -> usize {
    let mut photos = Vec::new();
    for p in paths {
        if p.is_dir() {
            photos.extend(watcher::existing(&p));
        } else if processor::is_photo(&p) {
            photos.push(p);
        }
    }
    let n = photos.len();
    send_all(&app, photos, &album, mode);
    n
}

#[tauri::command]
fn watch_start(
    app: AppHandle,
    folder: PathBuf,
    album: String,
    album_name: String,
    mode: Mode,
    include_existing: bool,
) -> Result<Setup, String> {
    {
        let state = app.state::<AppState>();
        let mut s = state.settings.lock().unwrap();
        s.folder = Some(folder);
        s.album = Some(album);
        s.album_name = album_name;
        s.mode = mode;
        s.watching = true;
        s.save(&app);
    }
    begin_watching(&app, include_existing)?;
    Ok(setup_of(&app))
}

#[tauri::command]
fn watch_stop(app: AppHandle) -> Setup {
    {
        let state = app.state::<AppState>();
        *state.watch.lock().unwrap() = None;
        let mut s = state.settings.lock().unwrap();
        s.watching = false;
        s.save(&app);
    }
    tray::status(&app, "în pauză");
    setup_of(&app)
}

#[tauri::command]
fn queue_get(app: AppHandle) -> uploader::Snapshot {
    app.state::<AppState>().queue.snapshot()
}

/// Sends again what failed: the folder is scanned and everything not yet in the album is queued.
#[tauri::command]
fn queue_retry(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    state.queue.clear_failed();
    let (folder, album, mode) = {
        let s = state.settings.lock().unwrap();
        (s.folder.clone().ok_or("Alege mai întâi folderul.")?, s.album.clone().ok_or("Alege mai întâi albumul.")?, s.mode)
    };
    tauri::async_runtime::spawn_blocking(move || send_all(&app, watcher::existing(&folder), &album, mode));
    Ok(())
}

#[tauri::command]
async fn retouch_start(app: AppHandle, album: String, album_name: String, photos: Vec<retouch::Photo>) -> Result<retouch::Info, String> {
    retouch::start(&app, album, album_name, photos).await
}

#[tauri::command]
async fn export_originals(app: AppHandle, album: String, album_name: String, photos: Vec<retouch::Photo>) -> Result<retouch::Exported, String> {
    retouch::export(&app, album, album_name, photos).await
}

#[tauri::command]
fn retouch_stop(app: AppHandle) {
    *app.state::<AppState>().retouch.lock().unwrap() = None;
}

#[tauri::command]
fn retouch_get(app: AppHandle) -> Option<retouch::Info> {
    let state = app.state::<AppState>();
    let r = state.retouch.lock().unwrap();
    r.as_ref().map(|a| retouch::Info { folder: a.folder.display().to_string(), album: a.album.clone() })
}

#[tauri::command]
fn reveal(app: AppHandle, path: PathBuf) -> Result<(), String> {
    app.opener().reveal_item_in_dir(path).map_err(|_| "Nu am putut deschide folderul.".to_string())
}

#[derive(Serialize)]
struct Prefs {
    autostart: bool,
    notifications: bool,
}

#[tauri::command]
fn prefs_get(app: AppHandle) -> Prefs {
    Prefs {
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
        notifications: app.state::<AppState>().settings.lock().unwrap().notifications,
    }
}

#[tauri::command]
fn prefs_set(app: AppHandle, autostart: bool, notifications: bool) -> Result<Prefs, String> {
    let launch = app.autolaunch();
    let done = if autostart { launch.enable() } else { launch.disable() };
    done.map_err(|_| "Nu am putut schimba pornirea cu sistemul.".to_string())?;
    {
        let state = app.state::<AppState>();
        let mut s = state.settings.lock().unwrap();
        s.notifications = notifications;
        s.save(&app);
    }
    Ok(prefs_get(app))
}

/// The window may only open pages of the site.
#[tauri::command]
fn site_open(app: AppHandle, path: String) -> Result<(), String> {
    if !path.starts_with('/') || path.starts_with("//") {
        return Err("Adresă nepermisă.".into());
    }
    app.opener()
        .open_url(format!("{}{}", api::base(), path), None::<&str>)
        .map_err(|_| "Nu am putut deschide browserul.".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // first, so a second start (and the hsk:// link that caused it on Windows) reaches the running app
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| tray::show(app)))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .setup(|app| {
            let handle = app.handle().clone();
            let (queue, intake) = uploader::Queue::new();
            app.manage(AppState {
                http: api::client(),
                settings: Mutex::new(Settings::load(&handle)),
                ledger: Ledger::load(&handle),
                watch: Mutex::new(None),
                retouch: Mutex::new(None),
                queue,
                last_code: Mutex::new(None),
            });
            uploader::spawn(&handle, intake);
            notify::spawn(&handle);
            tray::build(&handle)?;

            // installers register hsk://; a dev build on Windows or Linux registers itself
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            app.deep_link().register_all()?;
            let h = handle.clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    auth::handle_link(&h, url.as_str());
                }
            });
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls {
                    auth::handle_link(&handle, url.as_str());
                }
            }

            // started by the system at login: only the tray icon, the window waits to be opened
            if !std::env::args().any(|a| a == "--hidden") {
                tray::show(&handle);
            }

            // watching continues after a restart; what was exported in the meantime is picked up
            let resume = {
                let s = app.state::<AppState>();
                let s = s.settings.lock().unwrap();
                s.watching && s.album.is_some()
            };
            if resume && keyring::load().is_some() {
                let _ = begin_watching(&handle, true);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // the close button hides the window; the app leaves through the tray menu
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            auth::auth_state,
            auth::auth_start,
            auth::auth_claim,
            auth::auth_sign_out,
            api_call,
            setup_get,
            folder_pick,
            files_pick,
            upload_paths,
            watch_start,
            watch_stop,
            queue_get,
            queue_retry,
            retouch_start,
            retouch_stop,
            export_originals,
            retouch_get,
            reveal,
            prefs_get,
            prefs_set,
            site_open,
        ])
        .run(tauri::generate_context!())
        .expect("hsk. studio could not start");
}
