//! The upload queue: one photo at a time, in the order the folder produced them.
//!
//! watcher -> intake (skips what was already sent) -> worker (waits for the file to be complete,
//! makes the WebP when asked, uploads with retries) -> ledger.

use crate::api::{self, ApiError};
use crate::config::{Ledger, Mode};
use crate::{auth, keyring, processor, tray, AppState};
use serde::Serialize;
use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use tokio::time::sleep;

/// rows kept for the window; the counters cover the whole session
const SHOWN: usize = 40;
const RETRY_AFTER: [Duration; 3] = [Duration::from_secs(3), Duration::from_secs(10), Duration::from_secs(30)];

#[derive(Clone, Serialize)]
pub struct Item {
    id: u64,
    name: String,
    /// waiting | preparing | uploading | sent | duplicate | failed
    state: &'static str,
    detail: String,
}

#[derive(Clone, Serialize, Default)]
pub struct Snapshot {
    waiting: usize,
    sent: usize,
    failed: usize,
    items: Vec<Item>,
}

struct Job {
    id: u64,
    path: PathBuf,
    album: String,
    mode: Mode,
}

#[derive(Default)]
struct Inner {
    next: u64,
    items: VecDeque<Item>,
    pending: HashSet<PathBuf>,
    sent: usize,
    failed: usize,
}

pub struct Queue {
    /// where the watcher (and the scan of the folder) drops paths
    pub intake: UnboundedSender<PathBuf>,
    inner: Mutex<Inner>,
}

impl Queue {
    pub fn new() -> (Self, UnboundedReceiver<PathBuf>) {
        let (intake, rx) = unbounded_channel();
        (Queue { intake, inner: Mutex::new(Inner::default()) }, rx)
    }

    pub fn snapshot(&self) -> Snapshot {
        let q = self.inner.lock().unwrap();
        Snapshot {
            waiting: q.pending.len(),
            sent: q.sent,
            failed: q.failed,
            items: q.items.iter().rev().take(SHOWN).cloned().collect(),
        }
    }

    fn add(&self, path: &Path) -> Option<u64> {
        let mut q = self.inner.lock().unwrap();
        if !q.pending.insert(path.to_path_buf()) {
            return None;
        }
        q.next += 1;
        let id = q.next;
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        q.items.push_back(Item { id, name, state: "waiting", detail: String::new() });
        // finished rows fall off the top; rows still in work are always kept
        while q.items.len() > SHOWN * 4 {
            match q.items.iter().position(|i| matches!(i.state, "sent" | "duplicate" | "failed")) {
                Some(done) => q.items.remove(done),
                None => break,
            };
        }
        Some(id)
    }

    fn set(&self, job: &Job, state: &'static str, detail: &str) {
        let mut q = self.inner.lock().unwrap();
        match state {
            "sent" | "duplicate" => {
                q.sent += 1;
                q.pending.remove(&job.path);
            }
            "failed" => {
                q.failed += 1;
                q.pending.remove(&job.path);
            }
            _ => {}
        }
        if let Some(item) = q.items.iter_mut().find(|i| i.id == job.id) {
            item.state = state;
            item.detail = detail.to_string();
        }
    }

    /// already sent before: the row disappears without counting
    fn forget(&self, job: &Job) {
        let mut q = self.inner.lock().unwrap();
        q.pending.remove(&job.path);
        q.items.retain(|i| i.id != job.id);
    }

    pub fn clear_failed(&self) {
        let mut q = self.inner.lock().unwrap();
        q.failed = 0;
        q.items.retain(|i| i.state != "failed");
    }
}

fn publish(app: &AppHandle) {
    let snap = app.state::<AppState>().queue.snapshot();
    tray::status(
        app,
        &match (snap.waiting, snap.failed) {
            (0, 0) => format!("{} trimise", snap.sent),
            (0, f) => format!("{} trimise, {f} nereușite", snap.sent),
            (w, _) => format!("{w} în așteptare, {} trimise", snap.sent),
        },
    );
    let _ = app.emit("queue-changed", snap);
}

/// Starts the two background tasks. Called once, at startup.
pub fn spawn(app: &AppHandle, mut intake: UnboundedReceiver<PathBuf>) {
    let (jobs_tx, mut jobs) = unbounded_channel::<Job>();

    let a = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(path) = intake.recv().await {
            let state = a.state::<AppState>();
            let (album, mode) = {
                let s = state.settings.lock().unwrap();
                (s.album.clone(), s.mode)
            };
            let Some(album) = album else { continue };
            if Ledger::key(&album, &path).is_some_and(|k| state.ledger.has(&k)) {
                continue;
            }
            if let Some(id) = state.queue.add(&path) {
                let _ = jobs_tx.send(Job { id, path, album, mode });
                publish(&a);
            }
        }
    });

    let a = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(job) = jobs.recv().await {
            let state = a.state::<AppState>();
            match send(&a, &job).await {
                Ok(Sent::New) => state.queue.set(&job, "sent", ""),
                Ok(Sent::Duplicate) => state.queue.set(&job, "duplicate", "era deja în album"),
                Ok(Sent::Known) => state.queue.forget(&job),
                Err(message) => state.queue.set(&job, "failed", &message),
            }
            publish(&a);
        }
    });
}

enum Sent {
    New,
    Duplicate,
    /// the ledger already has this exact file
    Known,
}

/// An export is finished when the size stops changing.
async fn wait_complete(path: &Path) -> Result<u64, String> {
    let mut last = None;
    for _ in 0..240 {
        let size = tokio::fs::metadata(path)
            .await
            .map_err(|_| "Fișierul a fost mutat sau șters înainte de trimitere.".to_string())?
            .len();
        if size > 0 && last == Some(size) {
            return Ok(size);
        }
        last = Some(size);
        sleep(Duration::from_millis(500)).await;
    }
    Err("Fișierul este încă în scriere după două minute.".into())
}

async fn send(app: &AppHandle, job: &Job) -> Result<Sent, String> {
    let state = app.state::<AppState>();
    let size = wait_complete(&job.path).await?;
    let key = Ledger::key(&job.album, &job.path).ok_or("Fișierul nu a putut fi citit.")?;
    if state.ledger.has(&key) {
        return Ok(Sent::Known);
    }
    let token = keyring::load().ok_or("Aplicația nu este conectată la cont.")?;
    let name = job.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "poza.jpg".into());

    let (body, filename) = match job.mode {
        Mode::Webp => {
            state.queue.set(job, "preparing", "");
            publish(app);
            let path = job.path.clone();
            let webp = tauri::async_runtime::spawn_blocking(move || processor::to_webp(&path))
                .await
                .map_err(|_| "Poza nu a putut fi pregătită.".to_string())??;
            (webp, Path::new(&name).with_extension("webp").to_string_lossy().into_owned())
        }
        Mode::Original => {
            let max_mb = state.settings.lock().unwrap().max_photo_mb.max(1);
            if size > max_mb * 1024 * 1024 {
                return Err(format!("Poza depășește {max_mb} MB."));
            }
            let bytes = tokio::fs::read(&job.path).await.map_err(|_| "Fișierul nu a putut fi citit.".to_string())?;
            (bytes, name)
        }
    };

    state.queue.set(job, "uploading", "");
    publish(app);
    let mut attempt = 0;
    loop {
        match api::upload(&state.http, &token, &job.album, &filename, body.clone()).await {
            Ok(up) => {
                state.ledger.add(key);
                return Ok(if up.duplicate { Sent::Duplicate } else { Sent::New });
            }
            Err(ApiError::Temporary(message)) => {
                let Some(wait) = RETRY_AFTER.get(attempt) else { return Err(message) };
                attempt += 1;
                state.queue.set(job, "uploading", "se reîncearcă");
                publish(app);
                sleep(*wait).await;
            }
            Err(ApiError::Unauthorized(message)) => {
                auth::drop_session(app);
                return Err(message);
            }
            Err(ApiError::Rejected(message)) => return Err(message),
        }
    }
}
