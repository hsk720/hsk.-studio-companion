//! Watches the working folder and hands every new or changed photo to the upload queue.

use crate::processor::is_photo;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, FileIdMap};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::sync::mpsc::UnboundedSender;

/// An export writes a file in several steps; events closer than this count as one.
const DEBOUNCE: Duration = Duration::from_millis(1500);

/// Dropping it stops the watching.
pub struct Watch {
    _debouncer: Debouncer<RecommendedWatcher, FileIdMap>,
}

pub fn start(folder: &Path, tx: UnboundedSender<PathBuf>) -> Result<Watch, String> {
    if !folder.is_dir() {
        return Err("Folderul nu mai există. Alege-l din nou.".into());
    }
    let mut debouncer = new_debouncer(DEBOUNCE, None, move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        for event in events {
            if !matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
                continue;
            }
            for path in &event.paths {
                if is_photo(path) && path.is_file() {
                    let _ = tx.send(path.clone());
                }
            }
        }
    })
    .map_err(|_| "Nu am putut porni urmărirea folderului.".to_string())?;
    debouncer
        .watcher()
        .watch(folder, RecursiveMode::Recursive)
        .map_err(|_| "Nu am primit acces la folder. Verifică permisiunile din sistem.".to_string())?;
    debouncer.cache().add_root(folder, RecursiveMode::Recursive);
    Ok(Watch { _debouncer: debouncer })
}

/// The photos already in the folder, oldest name first.
pub fn existing(folder: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack = vec![folder.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            match entry.file_type() {
                Ok(t) if t.is_dir() => stack.push(path),
                Ok(t) if t.is_file() && is_photo(&path) => found.push(path),
                _ => {}
            }
        }
    }
    found.sort();
    found
}
