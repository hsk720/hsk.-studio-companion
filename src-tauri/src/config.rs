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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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
    /// native notifications for new notes, reports and finished face analysis
    #[serde(default = "yes")]
    pub notifications: bool,
}

fn yes() -> bool {
    true
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
