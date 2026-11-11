//! Lightroom, Capture One, Photoshop: the originals of the chosen photos are put in a folder; whatever is saved over
//! them there replaces the photo in the album, in the same place and at the same address.
//!
//! Files are named `<name>__<photo id>.<ext>`: the id after the double underscore says which photo a file replaces,
//! so the program may be given any copy of it and export under the same name.

use crate::api::{self, ApiError};
use crate::watcher::{self, Watch};
use crate::{keyring, AppState};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager};

pub struct Active {
    _watch: Watch,
    pub folder: PathBuf,
    pub album: String,
}

#[derive(Deserialize)]
pub struct Photo {
    pub id: String,
    pub filename: String,
}

#[derive(Serialize, Clone)]
struct FileEvent {
    name: String,
    /// sending | done | failed
    state: &'static str,
    message: String,
}

#[derive(Serialize)]
pub struct Info {
    pub folder: String,
    pub album: String,
}

fn safe(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_alphanumeric() || " ._-".contains(c) { c } else { '_' }).collect();
    let s = s.trim().trim_matches('.').to_string();
    if !s.chars().any(char::is_alphanumeric) { "album".into() } else { s.chars().take(60).collect() }
}

/// "IMG_0412__a1B2c3.jpg" → "a1B2c3"
fn photo_id(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    let (_, id) = stem.rsplit_once("__")?;
    (!id.is_empty() && id.len() <= 32 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'))
        .then(|| id.to_string())
}

fn stamp(path: &Path) -> Option<(u64, SystemTime)> {
    let m = std::fs::metadata(path).ok()?;
    Some((m.len(), m.modified().ok()?))
}

pub async fn start(app: &AppHandle, album: String, album_name: String, photos: Vec<Photo>) -> Result<Info, String> {
    let token = keyring::load().ok_or("Aplicația nu este conectată la cont.")?;
    let state = app.state::<AppState>();
    let root = app.path().document_dir().map_err(|_| "Nu găsesc folderul Documente.".to_string())?;
    let folder = root.join("hsk. studio").join(safe(&album_name)).join("de retușat");
    std::fs::create_dir_all(&folder).map_err(|_| "Nu am putut crea folderul de retușat.".to_string())?;

    // the previous session's watching ends first: its folder may be a different album's
    *state.retouch.lock().unwrap() = None;

    let mut failed = 0;
    for p in &photos {
        let ext = Path::new(&p.filename).extension().and_then(|e| e.to_str()).unwrap_or("jpg").to_ascii_lowercase();
        let stem = Path::new(&p.filename).file_stem().and_then(|s| s.to_str()).unwrap_or("poza");
        let dest = folder.join(format!("{}__{}.{}", safe(stem), p.id, ext));
        if dest.exists() {
            continue;
        }
        if api::download(&state.http, &token, &format!("/media/{album}/{}/original", p.id), &dest).await.is_err() {
            failed += 1;
            let _ = std::fs::remove_file(&dest);
        }
    }
    if failed == photos.len() && !photos.is_empty() {
        return Err("Nu am putut descărca pozele. Încearcă din nou.".into());
    }

    // what is there now is the original; only a later save counts as a new version
    let seen: Arc<Mutex<HashMap<PathBuf, (u64, SystemTime)>>> = Arc::new(Mutex::new(HashMap::new()));
    for p in watcher::existing(&folder) {
        if let Some(s) = stamp(&p) {
            seen.lock().unwrap().insert(p, s);
        }
    }

    let handle = app.clone();
    let album_code = album.clone();
    let watch = watcher::start(&folder, move |path| {
        let Some(id) = photo_id(&path) else { return };
        let Some(now) = stamp(&path) else { return };
        {
            let mut map = seen.lock().unwrap();
            if map.get(&path) == Some(&now) {
                return;
            }
            map.insert(path.clone(), now);
        }
        let (app, album) = (handle.clone(), album_code.clone());
        tauri::async_runtime::spawn(async move { send(&app, &album, &id, &path).await });
    })?;
    *state.retouch.lock().unwrap() = Some(Active { _watch: watch, folder: folder.clone(), album: album.clone() });
    Ok(Info { folder: folder.display().to_string(), album })
}

async fn send(app: &AppHandle, album: &str, id: &str, path: &Path) {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tell = |state: &'static str, message: String| {
        let _ = app.emit("retouch-file", FileEvent { name: name.clone(), state, message });
    };
    tell("sending", String::new());
    // an export is finished when its size stops changing
    let mut last = 0;
    for _ in 0..120 {
        let size = tokio::fs::metadata(path).await.map(|m| m.len()).unwrap_or(0);
        if size > 0 && size == last {
            break;
        }
        last = size;
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    let Ok(body) = tokio::fs::read(path).await else {
        return tell("failed", "Fișierul nu a putut fi citit.".into());
    };
    let state = app.state::<AppState>();
    let Some(token) = keyring::load() else { return tell("failed", "Aplicația nu este conectată.".into()) };
    for attempt in 0..3 {
        match api::replace(&state.http, &token, album, id, body.clone()).await {
            Ok(()) => return tell("done", String::new()),
            Err(ApiError::Temporary(m)) if attempt == 2 => return tell("failed", m),
            Err(ApiError::Temporary(_)) => tokio::time::sleep(Duration::from_secs(5 * (attempt + 1))).await,
            Err(ApiError::Unauthorized(m)) | Err(ApiError::Rejected(m)) => return tell("failed", m),
        }
    }
}

#[derive(Serialize)]
pub struct Exported {
    pub folder: String,
    pub failed: usize,
}

/// Every original of the album, under its own name, in `Documents/hsk. studio/<album>/originale`.
pub async fn export(app: &AppHandle, album: String, album_name: String, photos: Vec<Photo>) -> Result<Exported, String> {
    let token = keyring::load().ok_or("Aplicația nu este conectată la cont.")?;
    let state = app.state::<AppState>();
    let root = app.path().document_dir().map_err(|_| "Nu găsesc folderul Documente.".to_string())?;
    let folder = root.join("hsk. studio").join(safe(&album_name)).join("originale");
    std::fs::create_dir_all(&folder).map_err(|_| "Nu am putut crea folderul.".to_string())?;
    let (total, mut failed) = (photos.len(), 0);
    for (i, p) in photos.iter().enumerate() {
        let name = safe(&p.filename);
        // two photos may share a name (cameras restart their counter): the id keeps them apart
        let dest = if folder.join(&name).exists() {
            let (stem, ext) = (Path::new(&name).file_stem().and_then(|s| s.to_str()).unwrap_or("poza"), Path::new(&name).extension().and_then(|e| e.to_str()).unwrap_or("jpg"));
            folder.join(format!("{stem}__{}.{ext}", p.id))
        } else {
            folder.join(&name)
        };
        if api::download(&state.http, &token, &format!("/media/{album}/{}/original", p.id), &dest).await.is_err() {
            failed += 1;
            let _ = std::fs::remove_file(&dest);
        }
        let _ = app.emit("export-progress", (i + 1, total));
    }
    Ok(Exported { folder: folder.display().to_string(), failed })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_come_from_the_file_name() {
        assert_eq!(photo_id(Path::new("/x/IMG_0412__a1B2c3.jpg")).as_deref(), Some("a1B2c3"));
        assert_eq!(photo_id(Path::new("/x/a__b__zz-9_.png")).as_deref(), Some("zz-9_"));
        assert_eq!(photo_id(Path::new("/x/IMG_0412.jpg")), None);
        assert_eq!(photo_id(Path::new("/x/IMG__.jpg")), None);
    }

    #[test]
    fn folder_names_are_safe() {
        assert_eq!(safe("Nunta Ioana & Andrei"), "Nunta Ioana _ Andrei");
        assert_eq!(safe("../.."), "album");
    }
}
