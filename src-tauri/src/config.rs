//! Settings and the list of photos already sent, as JSON in the app's config folder.

use crate::api::Account;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// the file as exported, at full resolution
    #[default]
    Original,
    /// a 2560 px WebP made on this computer: a wedding goes up in minutes
    Webp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub folder: Option<PathBuf>,
    pub album: Option<String>,
    pub album_name: String,
    pub mode: Mode,
    /// watching restarts with the app
    pub watching: bool,
    /// shown while the server cannot be reached
    pub account: Option<Account>,
    pub max_photo_mb: u64,
    /// closing the window leaves the app running in the tray
    pub close_to_tray: bool,
    /// native notifications; the three below choose which ones
    pub notifications: bool,
    pub notify_notes: bool,
    pub notify_reports: bool,
    pub notify_analysis: bool,
    /// the WebP copy: long edge in px and quality
    pub webp_edge: u32,
    pub webp_quality: u8,
    /// the queue holds its photos until this is switched off
    pub paused: bool,
    /// the folder that collects exports, searched for new event folders
    pub inbox_enabled: bool,
    pub inbox_root: Option<PathBuf>,
    pub inbox_min: usize,
    /// folders answered with "yes" or "never ask": not offered again
    pub inbox_done: Vec<PathBuf>,
    pub notify_favorites: bool,
    /// upload speed limit, all day or only between two times (HH:MM, may cross midnight)
    pub limit_enabled: bool,
    pub limit_mbps: u32,
    pub limit_hours: bool,
    pub limit_from: String,
    pub limit_to: String,
    /// the studio's mark on the web copies
    pub wm_enabled: bool,
    pub wm_path: Option<PathBuf>,
    /// bl | center | br
    pub wm_pos: String,
    /// width of the mark as a percentage of the long edge
    pub wm_size: u32,
    pub wm_opacity: u32,
    /// system | lightroom | captureone | photoshop | custom: what "Editează" opens the photos in
    pub editor: String,
    pub editor_path: Option<PathBuf>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            folder: None,
            album: None,
            album_name: String::new(),
            mode: Mode::Original,
            watching: false,
            account: None,
            max_photo_mb: 0,
            close_to_tray: true,
            notifications: true,
            notify_notes: true,
            notify_reports: true,
            notify_analysis: true,
            webp_edge: crate::processor::LONG_EDGE,
            webp_quality: crate::processor::QUALITY as u8,
            paused: false,
            inbox_enabled: false,
            inbox_root: None,
            inbox_min: 10,
            inbox_done: Vec::new(),
            notify_favorites: true,
            limit_enabled: false,
            limit_mbps: 30,
            limit_hours: false,
            limit_from: "18:00".into(),
            limit_to: "23:00".into(),
            wm_enabled: false,
            wm_path: None,
            wm_pos: "br".into(),
            wm_size: 20,
            wm_opacity: 70,
            editor: "system".into(),
            editor_path: None,
        }
    }
}

fn dir(app: &AppHandle) -> PathBuf {
    let d = app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&d);
    d
}

fn write_atomic(path: &Path, data: &[u8]) {
    let tmp = path.with_extension("tmp");
    if fs::write(&tmp, data).is_ok() {
        let _ = fs::rename(&tmp, path);
    }
}

impl Settings {
    pub fn load(app: &AppHandle) -> Self {
        fs::read(dir(app).join("settings.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, app: &AppHandle) {
        if let Ok(b) = serde_json::to_vec_pretty(self) {
            write_atomic(&dir(app).join("settings.json"), &b);
        }
    }
}

/// What was already sent, so a restart or a re-save of the same file does not upload it twice.
/// The server also skips duplicates by content; this only saves the transfer.
pub struct Ledger {
    path: PathBuf,
    seen: Mutex<HashSet<String>>,
}

impl Ledger {
    pub fn load(app: &AppHandle) -> Self {
        let path = dir(app).join("sent.json");
        let seen = fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        Ledger { path, seen: Mutex::new(seen) }
    }

    /// album + path + size + modification time: an edited file counts as a new photo
    pub fn key(album: &str, file: &Path) -> Option<String> {
        let m = fs::metadata(file).ok()?;
        let t = m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
        Some(format!("{album}|{}|{}|{t}", file.display(), m.len()))
    }

    pub fn has(&self, key: &str) -> bool {
        self.seen.lock().unwrap().contains(key)
    }

    pub fn add(&self, key: String) {
        let mut seen = self.seen.lock().unwrap();
        seen.insert(key);
        if let Ok(b) = serde_json::to_vec(&*seen) {
            write_atomic(&self.path, &b);
        }
    }
}
