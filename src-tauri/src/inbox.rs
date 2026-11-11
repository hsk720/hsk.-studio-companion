//! The folder that collects exports: when a new folder with enough photos settles there, the window is asked
//! to offer an album for it. Folders that were already there when watching began are never announced.

use crate::{watcher, AppState};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const EVERY: Duration = Duration::from_secs(15);

#[derive(Clone, Serialize)]
pub struct Found {
    pub path: PathBuf,
    /// the folder name as a title: separators and the date taken out
    pub name: String,
    pub count: usize,
    /// day of the newest photo, YYYY-MM-DD
    pub date: String,
}

#[derive(Default)]
struct Inner {
    /// the root the baseline was taken for
    root: Option<PathBuf>,
    /// folders that were there before, or were already announced
    known: HashSet<PathBuf>,
    /// photo count at the previous look: a folder is announced when two looks agree
    counted: HashMap<PathBuf, usize>,
    pending: Vec<Found>,
}

#[derive(Default)]
pub struct Inbox {
    inner: Mutex<Inner>,
}

impl Inbox {
    pub fn pending(&self) -> Vec<Found> {
        self.inner.lock().unwrap().pending.clone()
    }

    /// The photographer answered: `done` means the folder is not offered again, even after a restart.
    pub fn resolve(&self, path: &Path) {
        let mut i = self.inner.lock().unwrap();
        i.pending.retain(|f| f.path != path);
        i.known.insert(path.to_path_buf());
    }
}

fn subfolders(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else { return Vec::new() };
    entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .map(|e| e.path())
        .filter(|p| !p.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')))
        .collect()
}

/// "Botez_Matei_2026-11-08" -> "Botez Matei"
pub fn title_of(folder: &Path) -> String {
    let raw = folder.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let mut words = Vec::new();
    let mut after_year = 0;
    for token in raw.split(|c: char| matches!(c, '_' | '-' | '.' | ' ')).filter(|t| !t.is_empty()) {
        let digits = token.chars().all(|c| c.is_ascii_digit());
        if digits && token.len() == 4 && (token.starts_with("19") || token.starts_with("20")) {
            after_year = 2;
        } else if digits && token.len() <= 2 && after_year > 0 {
            after_year -= 1;
        } else {
            after_year = 0;
            words.push(token);
        }
    }
    if words.is_empty() {
        raw
    } else {
        words.join(" ")
    }
}

/// Day of a unix time as YYYY-MM-DD (proleptic Gregorian, UTC).
pub fn day_of(secs: u64) -> String {
    let z = (secs / 86_400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

fn newest(photos: &[PathBuf]) -> u64 {
    photos
        .iter()
        .filter_map(|p| std::fs::metadata(p).ok()?.modified().ok()?.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .max()
        .unwrap_or_else(|| SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs()))
}

pub fn spawn(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(EVERY).await;
            let state = app.state::<AppState>();
            let (enabled, root, min, done, watched) = {
                let s = state.settings.lock().unwrap();
                (s.inbox_enabled, s.inbox_root.clone(), s.inbox_min.max(1), s.inbox_done.clone(), s.folder.clone())
            };
            let Some(root) = root.filter(|_| enabled) else {
                *state.inbox.inner.lock().unwrap() = Inner::default();
                continue;
            };

            // a new root (or the first look): everything inside it now is the past
            let fresh = state.inbox.inner.lock().unwrap().root.as_deref() != Some(root.as_path());
            if fresh {
                let known: HashSet<PathBuf> = subfolders(&root).into_iter().chain(done).collect();
                *state.inbox.inner.lock().unwrap() = Inner { root: Some(root), known, ..Inner::default() };
                continue;
            }

            let candidates: Vec<PathBuf> = {
                let i = state.inbox.inner.lock().unwrap();
                subfolders(&root)
                    .into_iter()
                    .filter(|p| !i.known.contains(p) && !i.pending.iter().any(|f| &f.path == p) && Some(p) != watched.as_ref())
                    .collect()
            };
            for folder in candidates {
                let looked = folder.clone();
                let Ok(photos) = tauri::async_runtime::spawn_blocking(move || watcher::existing(&looked)).await else { continue };
                let count = photos.len();
                let found = {
                    let mut i = state.inbox.inner.lock().unwrap();
                    let steady = i.counted.insert(folder.clone(), count) == Some(count);
                    if steady && count >= min {
                        let f = Found { name: title_of(&folder), count, date: day_of(newest(&photos)), path: folder.clone() };
                        i.pending.push(f.clone());
                        Some(f)
                    } else {
                        None
                    }
                };
                if let Some(f) = found {
                    crate::notify::tell(&app, "Folder nou", &format!("„{}” are {count} poze. Deschide hsk. studio ca să faci un album.", f.name));
                    let _ = app.emit("folder-detected", f);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_names_become_titles() {
        assert_eq!(title_of(Path::new("/x/Botez_Matei_2026-11-08")), "Botez Matei");
        assert_eq!(title_of(Path::new("/x/2026-11-08 Nunta Ana si Dan")), "Nunta Ana si Dan");
        assert_eq!(title_of(Path::new("/x/Clasa 12 B")), "Clasa 12 B");
        assert_eq!(title_of(Path::new("/x/2026-11-08")), "2026-11-08");
    }

    #[test]
    fn days_are_formatted() {
        assert_eq!(day_of(0), "1970-01-01");
        assert_eq!(day_of(1_794_000_000), "2026-11-06");
        assert_eq!(day_of(951_782_400), "2000-02-29");
    }
}
