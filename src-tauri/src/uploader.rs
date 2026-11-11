//! The upload queue: one photo at a time, in the order the folder produced them.
//!
//! watcher -> intake (skips what was already sent) -> worker (waits for the file to be complete,
//! makes the WebP when asked, uploads with retries) -> ledger.

use crate::api::{self, ApiError};
use crate::config::{Ledger, Mode};
use crate::{auth, keyring, processor, tray, AppState};
use serde::Serialize;
use sha2::{Digest, Sha256};
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
    /// the server reports the same SHA-256 as the file that left this computer
    verified: bool,
}

#[derive(Clone, Serialize, Default)]
pub struct Snapshot {
    waiting: usize,
    sent: usize,
    failed: usize,
    items: Vec<Item>,
}

/// What the watcher, a dropped folder or a retry hands to the queue.
pub struct Task {
    pub path: PathBuf,
    pub album: String,
    pub mode: Mode,
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
    pub intake: UnboundedSender<Task>,
    inner: Mutex<Inner>,
}

impl Queue {
    pub fn new() -> (Self, UnboundedReceiver<Task>) {
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
        q.items.push_back(Item { id, name, state: "waiting", detail: String::new(), verified: false });
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

    fn verified(&self, job: &Job) {
        let mut q = self.inner.lock().unwrap();
        if let Some(item) = q.items.iter_mut().find(|i| i.id == job.id) {
            item.verified = true;
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
pub fn spawn(app: &AppHandle, mut intake: UnboundedReceiver<Task>) {
    let (jobs_tx, mut jobs) = unbounded_channel::<Job>();

    let a = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(Task { path, album, mode }) = intake.recv().await {
            let state = a.state::<AppState>();
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
            // paused from the settings: the photo waits in the queue
            while state.settings.lock().unwrap().paused {
                sleep(Duration::from_secs(1)).await;
            }
            match send(&a, &job).await {
                Ok(Sent::New(v)) => {
                    state.queue.set(&job, "sent", "");
                    if v {
                        state.queue.verified(&job);
                    }
                }
                Ok(Sent::Duplicate) => state.queue.set(&job, "duplicate", "era deja în album"),
                Ok(Sent::Known) => state.queue.forget(&job),
                Err(message) => state.queue.set(&job, "failed", &message),
            }
            publish(&a);
        }
    });
}

enum Sent {
    /// uploaded; true when the server's hash matched
    New(bool),
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
            let (edge, quality, mark) = {
                let s = state.settings.lock().unwrap();
                let mark = s.wm_path.clone().filter(|_| s.wm_enabled).map(|path| processor::Watermark { path, pos: s.wm_pos.clone(), size: s.wm_size, opacity: s.wm_opacity });
                (s.webp_edge, s.webp_quality, mark)
            };
            let webp = tauri::async_runtime::spawn_blocking(move || processor::to_webp(&path, edge, quality, mark.as_ref()))
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
    let local = format!("{:x}", Sha256::digest(&body));
    let bytes = body.len() as u64;
    let mut attempt = 0;
    loop {
        let began = std::time::Instant::now();
        match api::upload(&state.http, &token, &job.album, &filename, body.clone()).await {
            Ok(up) => {
                if up.sha256.as_deref().is_some_and(|remote| !remote.eq_ignore_ascii_case(&local)) {
                    return Err("Poza a ajuns alterată pe server. Încearc-o din nou.".into());
                }
                let verified = up.sha256.is_some();
                state.ledger.add(key);
                // under a speed limit the upload is stretched to the time it should have taken
                if let Some(mbps) = limit_now(&state) {
                    let target = Duration::from_secs_f64(bytes as f64 * 8.0 / (f64::from(mbps) * 1_000_000.0));
                    if let Some(rest) = target.checked_sub(began.elapsed()) {
                        sleep(rest).await;
                    }
                }
                return Ok(if up.duplicate { Sent::Duplicate } else { Sent::New(verified) });
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

/// The speed limit in force right now, in Mbps: all day, or only between the two times set.
fn limit_now(state: &AppState) -> Option<u32> {
    let s = state.settings.lock().unwrap();
    if !s.limit_enabled {
        return None;
    }
    if !s.limit_hours {
        return Some(s.limit_mbps.max(1));
    }
    let parse = |t: &str| chrono::NaiveTime::parse_from_str(t, "%H:%M").ok();
    let (from, to) = (parse(&s.limit_from)?, parse(&s.limit_to)?);
    let now = chrono::Local::now().time();
    let inside = if from <= to { now >= from && now < to } else { now >= from || now < to };
    inside.then(|| s.limit_mbps.max(1))
}
