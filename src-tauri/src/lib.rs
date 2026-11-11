//! hsk. studio: the photographer's panel on the desktop, with the folder that fills the album by itself.

mod api;
mod auth;
mod catalog;
mod config;
mod editors;
mod inbox;
mod keyring;
mod notify;
mod processor;
mod retouch;
mod tray;
mod uploader;
mod watcher;
mod xmp;

use config::{Ledger, Mode, Settings};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
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
    pub inbox: inbox::Inbox,
    pub catalog: catalog::Catalog,
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
    let (tx, code, handle) = (state.queue.intake.clone(), album.clone(), app.clone());
    let watch = watcher::start(&folder, move |path| {
        let mode = handle.state::<AppState>().settings.lock().unwrap().mode;
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
    r.as_ref().map(|a| retouch::Info { folder: a.folder.display().to_string(), album: a.album.clone(), editor: String::new() })
}

#[tauri::command]
fn reveal(app: AppHandle, path: PathBuf) -> Result<(), String> {
    app.opener().reveal_item_in_dir(path).map_err(|_| "Nu am putut deschide folderul.".to_string())
}

/// Everything the settings page shows, in one flat object: the window sends it back whole after each change.
#[derive(Serialize, Deserialize)]
struct Prefs {
    autostart: bool,
    close_to_tray: bool,
    notifications: bool,
    notify_notes: bool,
    notify_reports: bool,
    notify_analysis: bool,
    mode: Mode,
    webp_edge: u32,
    webp_quality: u8,
    paused: bool,
    inbox_enabled: bool,
    inbox_root: Option<PathBuf>,
    inbox_min: usize,
    notify_favorites: bool,
    limit_enabled: bool,
    limit_mbps: u32,
    limit_hours: bool,
    limit_from: String,
    limit_to: String,
    wm_enabled: bool,
    wm_path: Option<PathBuf>,
    wm_pos: String,
    wm_size: u32,
    wm_opacity: u32,
    editor: String,
    editor_path: Option<PathBuf>,
}

#[tauri::command]
fn prefs_get(app: AppHandle) -> Prefs {
    let s = app.state::<AppState>().settings.lock().unwrap().clone();
    Prefs {
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
        close_to_tray: s.close_to_tray,
        notifications: s.notifications,
        notify_notes: s.notify_notes,
        notify_reports: s.notify_reports,
        notify_analysis: s.notify_analysis,
        mode: s.mode,
        webp_edge: s.webp_edge,
        webp_quality: s.webp_quality,
        paused: s.paused,
        inbox_enabled: s.inbox_enabled,
        inbox_root: s.inbox_root,
        inbox_min: s.inbox_min,
        notify_favorites: s.notify_favorites,
        limit_enabled: s.limit_enabled,
        limit_mbps: s.limit_mbps,
        limit_hours: s.limit_hours,
        limit_from: s.limit_from,
        limit_to: s.limit_to,
        wm_enabled: s.wm_enabled,
        wm_path: s.wm_path,
        wm_pos: s.wm_pos,
        wm_size: s.wm_size,
        wm_opacity: s.wm_opacity,
        editor: s.editor,
        editor_path: s.editor_path,
    }
}

#[tauri::command]
fn prefs_set(app: AppHandle, prefs: Prefs) -> Result<Prefs, String> {
    if prefs.autostart != app.autolaunch().is_enabled().unwrap_or(false) {
        let launch = app.autolaunch();
        let done = if prefs.autostart { launch.enable() } else { launch.disable() };
        done.map_err(|_| "Nu am putut schimba pornirea cu sistemul.".to_string())?;
    }
    {
        let state = app.state::<AppState>();
        let mut s = state.settings.lock().unwrap();
        s.close_to_tray = prefs.close_to_tray;
        s.notifications = prefs.notifications;
        s.notify_notes = prefs.notify_notes;
        s.notify_reports = prefs.notify_reports;
        s.notify_analysis = prefs.notify_analysis;
        s.mode = prefs.mode;
        s.webp_edge = prefs.webp_edge.clamp(800, 4096);
        s.webp_quality = prefs.webp_quality.clamp(40, 95);
        s.paused = prefs.paused;
        s.inbox_enabled = prefs.inbox_enabled;
        s.inbox_root = prefs.inbox_root;
        s.inbox_min = prefs.inbox_min.clamp(1, 500);
        s.notify_favorites = prefs.notify_favorites;
        s.limit_enabled = prefs.limit_enabled;
        s.limit_mbps = prefs.limit_mbps.clamp(1, 10_000);
        s.limit_hours = prefs.limit_hours;
        let valid = |t: &str| chrono::NaiveTime::parse_from_str(t, "%H:%M").is_ok();
        if valid(&prefs.limit_from) && valid(&prefs.limit_to) {
            s.limit_from = prefs.limit_from;
            s.limit_to = prefs.limit_to;
        }
        s.wm_enabled = prefs.wm_enabled;
        s.wm_path = prefs.wm_path;
        s.wm_pos = if ["bl", "center", "br"].contains(&prefs.wm_pos.as_str()) { prefs.wm_pos } else { "br".into() };
        s.wm_size = prefs.wm_size.clamp(5, 60);
        s.wm_opacity = prefs.wm_opacity.clamp(10, 100);
        s.editor = if ["system", "lightroom", "captureone", "photoshop", "custom"].contains(&prefs.editor.as_str()) { prefs.editor } else { "system".into() };
        s.editor_path = prefs.editor_path;
        s.save(&app);
    }
    Ok(prefs_get(app))
}

/// Folders the app noticed that nobody has answered yet: the window asks again after a restart or a reload.
#[tauri::command]
fn inbox_pending(app: AppHandle) -> Vec<inbox::Found> {
    app.state::<AppState>().inbox.pending()
}

/// `done`: the folder is not offered again, not even after a restart.
#[tauri::command]
fn inbox_resolve(app: AppHandle, path: PathBuf, done: bool) {
    let state = app.state::<AppState>();
    if done {
        state.inbox.resolve(&path);
        let mut s = state.settings.lock().unwrap();
        if !s.inbox_done.contains(&path) {
            s.inbox_done.push(path);
            s.save(&app);
        }
    }
}

/// Where the program is installed, when it is in the usual place.
#[tauri::command]
fn editor_detect(kind: String) -> Option<PathBuf> {
    editors::detect(&kind)
}

/// A program chosen by hand: an .app on a Mac, an .exe on Windows.
#[tauri::command]
async fn editor_pick(app: AppHandle) -> Option<PathBuf> {
    app.dialog().file().set_title("Alege programul de editare").blocking_pick_file()?.into_path().ok()
}

/// A file made by the server (the kit PDF) handed to the photographer: saved in Downloads, and opened when asked.
#[tauri::command]
fn save_file(app: AppHandle, name: String, data: String, open: bool) -> Result<PathBuf, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.as_bytes()).map_err(|_| "Fișierul primit nu e valid.".to_string())?;
    let clean: String = name.chars().map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '-' }).collect();
    let clean = if clean.to_lowercase().ends_with(".pdf") { clean } else { format!("{clean}.pdf") };
    let dir = app.path().download_dir().map_err(|_| "Nu găsesc folderul Descărcări.".to_string())?;
    let (stem, mut path, mut n) = (clean.trim_end_matches(".pdf").to_string(), dir.join(&clean), 1);
    while path.exists() {
        n += 1;
        path = dir.join(format!("{stem} ({n}).pdf"));
    }
    std::fs::write(&path, bytes).map_err(|_| "Nu am putut salva fișierul.".to_string())?;
    if open {
        app.opener().open_path(path.to_string_lossy().to_string(), None::<&str>).map_err(|_| "Nu am putut deschide fișierul.".to_string())?;
    }
    Ok(path)
}

/// Stars and a green label in the .xmp next to the RAW files of the clients' selection.
#[tauri::command]
async fn xmp_mark(folder: PathBuf, names: Vec<String>, rating: u8, label: String) -> Result<xmp::Report, String> {
    if !folder.is_dir() {
        return Err("Folderul nu mai există. Alege-l din nou.".into());
    }
    let label = if ["Red", "Yellow", "Green", "Blue", "Purple"].contains(&label.as_str()) { label } else { "Green".into() };
    tauri::async_runtime::spawn_blocking(move || xmp::mark(&folder, &names, rating.min(5), &label)).await.map_err(|_| "Nu am putut scrie marcajele.".to_string())
}

#[tauri::command]
fn catalog_roots(app: AppHandle) -> Vec<catalog::RootInfo> {
    app.state::<AppState>().catalog.roots()
}

async fn index_root(app: AppHandle, root: catalog::Root) {
    let (handle, label, path) = (app.clone(), root.label.clone(), root.path.clone());
    let entries = tauri::async_runtime::spawn_blocking(move || {
        catalog::scan(&path, |n| {
            let _ = handle.emit("catalog-progress", serde_json::json!({ "label": label, "files": n, "done": false }));
        })
    })
    .await
    .unwrap_or_default();
    app.state::<AppState>().catalog.put(root, entries);
    let _ = app.emit("catalog-progress", serde_json::json!({ "label": "", "files": 0, "done": true }));
}

#[tauri::command]
async fn catalog_add(app: AppHandle, path: PathBuf, label: String) -> Result<(), String> {
    if !path.is_dir() {
        return Err("Folderul sau discul nu este conectat.".into());
    }
    let label = label.trim().chars().take(60).collect::<String>();
    let root = catalog::Root { id: catalog::Catalog::new_id(), label: if label.is_empty() { "Disc".into() } else { label }, path, files: 0, updated: 0 };
    index_root(app, root).await;
    Ok(())
}

#[tauri::command]
async fn catalog_rescan(app: AppHandle, id: String) -> Result<(), String> {
    let root = app.state::<AppState>().catalog.find(&id).ok_or("Locul nu mai e în catalog.")?;
    if !root.path.is_dir() {
        return Err("Discul nu este conectat.".into());
    }
    index_root(app, root).await;
    Ok(())
}

#[tauri::command]
fn catalog_remove(app: AppHandle, id: String) {
    app.state::<AppState>().catalog.remove(&id);
}

#[tauri::command]
async fn catalog_search(app: AppHandle, query: String, limit: usize) -> catalog::Found {
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().catalog.search(&query, limit.clamp(1, 500))).await.unwrap_or_default()
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
                inbox: inbox::Inbox::default(),
                catalog: catalog::Catalog::default(),
                last_code: Mutex::new(None),
            });
            uploader::spawn(&handle, intake);
            notify::spawn(&handle);
            inbox::spawn(&handle);
            if let Ok(dir) = handle.path().app_config_dir() {
                app.state::<AppState>().catalog.open(dir.join("catalog"));
            }
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
                if std::env::args().any(|a| a == "--hidden") {
                    // started with the computer: wait, so the login does not compete with everything else for the network
                    let h = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                        let _ = begin_watching(&h, true);
                    });
                } else {
                    let _ = begin_watching(&handle, true);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // the close button hides the window, unless the settings say it should quit; the tray menu always quits
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if app.state::<AppState>().settings.lock().unwrap().close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    app.exit(0);
                }
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
            inbox_pending,
            inbox_resolve,
            xmp_mark,
            save_file,
            editor_detect,
            editor_pick,
            catalog_roots,
            catalog_add,
            catalog_rescan,
            catalog_remove,
            catalog_search,
            site_open,
        ])
        .run(tauri::generate_context!())
        .expect("hsk. studio could not start");
}
