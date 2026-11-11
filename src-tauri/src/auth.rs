//! Pairing with the photographer's account.
//!
//! The site (https://hsk.photos/auth/desktop) shows a one-time code and opens `hsk://auth?code=XXXXXXXX`.
//! The app trades the code for a session token over HTTPS and keeps the token in the system keychain.
//! The token itself never travels in a link, so it cannot end up in browser history or in a log.

use crate::api::{self, Account, ApiError};
use crate::{keyring, tray, AppState};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

/// The code alphabet on the server: no 0/O, 1/I/L.
const ALPHABET: &str = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN: usize = 8;

#[derive(Debug, Clone, Serialize, Default)]
pub struct AuthState {
    pub connected: bool,
    /// connected, but the server could not be reached to confirm it
    pub offline: bool,
    pub account: Option<Account>,
}

/// "abcd-efgh", "ABCD EFGH" and "ABCDEFGH" are the same code.
pub fn normalize_code(raw: &str) -> Option<String> {
    let code: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect();
    (code.len() == CODE_LEN && code.chars().all(|c| ALPHABET.contains(c))).then_some(code)
}

/// Only `hsk://auth?code=…` is accepted; any other link is ignored.
pub fn code_from_link(link: &str) -> Option<String> {
    let url = url::Url::parse(link).ok()?;
    if url.scheme() != "hsk" || url.host_str() != Some("auth") {
        return None;
    }
    let code = url.query_pairs().find(|(k, _)| k == "code").map(|(_, v)| v.into_owned())?;
    normalize_code(&code)
}

fn device_name() -> String {
    let host = hostname::get().ok().and_then(|h| h.into_string().ok()).unwrap_or_default();
    let os = if cfg!(target_os = "macos") {
        "macOS"
    } else if cfg!(target_os = "windows") {
        "Windows"
    } else {
        "Linux"
    };
    if host.is_empty() { os.to_string() } else { format!("{host} ({os})") }
}

fn remember(app: &AppHandle, account: Option<Account>, max_photo_mb: Option<u64>) {
    let state = app.state::<AppState>();
    let mut s = state.settings.lock().unwrap();
    s.account = account;
    if let Some(mb) = max_photo_mb {
        s.max_photo_mb = mb;
    }
    s.save(app);
}

async fn connect(app: &AppHandle, raw: &str) -> Result<AuthState, String> {
    let code = normalize_code(raw).ok_or("Codul are 8 litere și cifre, de forma ABCD-EFGH.")?;
    let state = app.state::<AppState>();
    let (token, account) = api::claim(&state.http, &code, &device_name()).await.map_err(|e| e.to_string())?;
    keyring::save(&token)?;
    remember(app, Some(account.clone()), None);
    let auth = AuthState { connected: true, offline: false, account: Some(account) };
    let _ = app.emit("auth-changed", &auth);
    Ok(auth)
}

/// The session is gone (signed out here, revoked on the site, account suspended).
pub fn drop_session(app: &AppHandle) {
    keyring::clear();
    let state = app.state::<AppState>();
    *state.watch.lock().unwrap() = None;
    {
        let mut s = state.settings.lock().unwrap();
        s.account = None;
        s.watching = false;
        s.save(app);
    }
    tray::status(app, "neconectat");
    let _ = app.emit("auth-changed", AuthState::default());
}

/// A link opened by the system. Runs in the background and reports to the window through events.
pub fn handle_link(app: &AppHandle, link: &str) {
    let Some(code) = code_from_link(link) else { return };
    {
        // macOS delivers the link that started the app twice: as the start link and as an event
        let state = app.state::<AppState>();
        let mut last = state.last_code.lock().unwrap();
        if last.as_deref() == Some(code.as_str()) {
            return;
        }
        *last = Some(code.clone());
    }
    tray::show(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = app.emit("auth-pending", ());
        if let Err(message) = connect(&app, &code).await {
            let _ = app.emit("auth-error", message);
        }
    });
}

#[tauri::command]
pub async fn auth_state(app: AppHandle) -> AuthState {
    let Some(token) = keyring::load() else { return AuthState::default() };
    let state = app.state::<AppState>();
    match api::me(&state.http, &token).await {
        Ok(me) => {
            remember(&app, Some(me.account.clone()), Some(me.max_photo_mb));
            AuthState { connected: true, offline: false, account: Some(me.account) }
        }
        Err(ApiError::Unauthorized(_)) => {
            drop_session(&app);
            AuthState::default()
        }
        Err(_) => {
            let account = state.settings.lock().unwrap().account.clone();
            AuthState { connected: true, offline: true, account }
        }
    }
}

/// Opens the pairing page in the browser; the site sends the photographer back through the hsk:// link.
#[tauri::command]
pub fn auth_start(app: AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(format!("{}/auth/desktop", api::base()), None::<&str>)
        .map_err(|_| "Nu am putut deschide browserul. Intră pe hsk.photos/auth/desktop.".to_string())
}

/// The fallback when the link does not open the app: the photographer types the code from the site.
#[tauri::command]
pub async fn auth_claim(app: AppHandle, code: String) -> Result<AuthState, String> {
    connect(&app, &code).await
}

#[tauri::command]
pub async fn auth_sign_out(app: AppHandle) {
    if let Some(token) = keyring::load() {
        // revoked on the server too; if the server cannot be reached, the token is still deleted here
        let _ = api::sign_out(&app.state::<AppState>().http, &token).await;
    }
    drop_session(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes() {
        assert_eq!(normalize_code("abcd-efgh").as_deref(), Some("ABCDEFGH"));
        assert_eq!(normalize_code(" ABCD EFGH ").as_deref(), Some("ABCDEFGH"));
        assert_eq!(normalize_code("ABCD-EFG"), None);
        assert_eq!(normalize_code("ABCD-EFG0"), None); // 0 is not in the alphabet
    }

    #[test]
    fn links() {
        assert_eq!(code_from_link("hsk://auth?code=ABCDEFGH").as_deref(), Some("ABCDEFGH"));
        assert_eq!(code_from_link("hsk://auth/?code=abcd-efgh").as_deref(), Some("ABCDEFGH"));
        assert_eq!(code_from_link("hsk://other?code=ABCDEFGH"), None);
        assert_eq!(code_from_link("https://auth?code=ABCDEFGH"), None);
        assert_eq!(code_from_link("hsk://auth?token=ABCDEFGH"), None);
    }
}
