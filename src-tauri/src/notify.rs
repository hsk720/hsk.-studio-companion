//! Native notifications. Every two minutes the newest albums are looked at; what is new since the last look is
//! announced: a note from a guest, a report, or the end of the face analysis.

use crate::{api, keyring, AppState};
use std::collections::HashMap;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

const EVERY: Duration = Duration::from_secs(120);
const ALBUMS: usize = 6;

#[derive(Clone, Copy, Default)]
struct Seen {
    notes: usize,
    open_reports: usize,
    pending: u64,
}

fn tell(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

pub fn spawn(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last: HashMap<String, Seen> = HashMap::new();
        loop {
            tokio::time::sleep(EVERY).await;
            let state = app.state::<AppState>();
            if !state.settings.lock().unwrap().notifications {
                continue;
            }
            let Some(token) = keyring::load() else { continue };
            let Ok(list) = api::albums(&state.http, &token).await else { continue };
            let albums = list.get("albums").and_then(|a| a.as_array()).cloned().unwrap_or_default();
            for a in albums.iter().take(ALBUMS) {
                let (Some(code), name) = (a["code"].as_str(), a["name"].as_str().unwrap_or("Album")) else { continue };
                let Ok(m) = api::request(&state.http, &token, "GET", &format!("/api/albums/{code}/manage?photos=false"), None).await
                else {
                    continue;
                };
                let now = Seen {
                    notes: m["notes"].as_array().map_or(0, |n| n.len()),
                    open_reports: m["reports"].as_array().map_or(0, |r| r.iter().filter(|x| x["status"] == "open").count()),
                    pending: m["pending_analysis"].as_u64().unwrap_or(0),
                };
                // the first look only records: opening the app does not announce the past
                if let Some(before) = last.get(code) {
                    if now.notes > before.notes {
                        tell(&app, name, "O notiță nouă de la un invitat.");
                    }
                    if now.open_reports > before.open_reports {
                        tell(&app, name, "O sesizare nouă la o poză din album.");
                    }
                    if before.pending > 0 && now.pending == 0 {
                        tell(&app, name, "Analiza fețelor s-a terminat.");
                    }
                }
                last.insert(code.to_string(), now);
            }
        }
    });
}
