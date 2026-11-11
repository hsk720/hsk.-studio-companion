//! hsk. Studio Companion: the photos exported into a folder go straight into an hsk. photos album.

mod api;
mod auth;
mod config;
mod keyring;
mod processor;
mod tray;
mod uploader;
mod watcher;

use config::{Ledger, Mode, Settings};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

pub struct AppState {
    pub http: reqwest::Client,
    pub settings: Mutex<Settings>,
    pub ledger: Ledger,
    pub watch: Mutex<Option<watcher::Watch>>,
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

fn begin_watching(app: &AppHandle, include_existing: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let folder = state.settings.lock().unwrap().folder.clone().ok_or("Alege mai întâi folderul.")?;
    let watch = watcher::start(&folder, state.queue.intake.clone())?;
    *state.watch.lock().unwrap() = Some(watch);
    if include_existing {
        let intake = state.queue.intake.clone();
        tauri::async_runtime::spawn_blocking(move || {
            for path in watcher::existing(&folder) {
                let _ = intake.send(path);
            }
        });
    }
    tray::status(app, "urmărește folderul");
    Ok(())
}

#[tauri::command]
fn setup_get(app: AppHandle) -> Setup {
    setup_of(&app)
}

#[tauri::command]
async fn albums_list(app: AppHandle) -> Result<serde_json::Value, String> {
    let token = keyring::load().ok_or("Aplicația nu este conectată la cont.")?;
    match api::albums(&app.state::<AppState>().http, &token).await {
        Ok(albums) => Ok(albums),
        Err(api::ApiError::Unauthorized(message)) => {
            auth::drop_session(&app);
            Err(message)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn folder_pick(app: AppHandle) -> Option<PathBuf> {
    app.dialog().file().set_title("Folderul în care exporți pozele").blocking_pick_folder()?.into_path().ok()
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
    let folder = state.settings.lock().unwrap().folder.clone().ok_or("Alege mai întâi folderul.")?;
    let intake = state.queue.intake.clone();
    tauri::async_runtime::spawn_blocking(move || {
        for path in watcher::existing(&folder) {
            let _ = intake.send(path);
        }
    });
    Ok(())
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
        .setup(|app| {
            let handle = app.handle().clone();
            let (queue, intake) = uploader::Queue::new();
            app.manage(AppState {
                http: api::client(),
                settings: Mutex::new(Settings::load(&handle)),
                ledger: Ledger::load(&handle),
                watch: Mutex::new(None),
                queue,
                last_code: Mutex::new(None),
            });
            uploader::spawn(&handle, intake);
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
            setup_get,
            albums_list,
            folder_pick,
            watch_start,
            watch_stop,
            queue_get,
            queue_retry,
            site_open,
        ])
        .run(tauri::generate_context!())
        .expect("hsk. Studio Companion could not start");
}
