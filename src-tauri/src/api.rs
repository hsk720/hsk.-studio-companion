//! The hsk. photos API as the app uses it: pairing, account, albums and photo upload.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;
use std::time::Duration;

const SHORT: Duration = Duration::from_secs(20);
const UPLOAD: Duration = Duration::from_secs(600);

pub fn base() -> String {
    // debug builds can point at a test server
    #[cfg(debug_assertions)]
    if let Ok(b) = std::env::var("HSK_API_BASE") {
        return b.trim_end_matches('/').to_string();
    }
    "https://hsk.photos".into()
}

#[derive(Debug)]
pub enum ApiError {
    /// the session was revoked or expired: the app has to be paired again
    Unauthorized(String),
    /// the server refused the request and will refuse it again (bad code, plan limit, bad file)
    Rejected(String),
    /// no network, a timeout or a 5xx: worth another try
    Temporary(String),
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ApiError::Unauthorized(m) | ApiError::Rejected(m) | ApiError::Temporary(m) => f.write_str(m),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub name: String,
    #[serde(default)]
    pub plan: String,
    #[serde(default)]
    pub owner: bool,
}

#[derive(Deserialize)]
struct Claimed {
    token: String,
    account: Account,
}

#[derive(Deserialize)]
pub struct Me {
    pub account: Account,
    #[serde(default = "default_max_mb")]
    pub max_photo_mb: u64,
}

fn default_max_mb() -> u64 {
    60
}

#[derive(Deserialize)]
pub struct Uploaded {
    #[serde(default)]
    pub duplicate: bool,
}

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("hsk-studio-companion/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .expect("http client")
}

async fn read<T: DeserializeOwned>(sent: Result<reqwest::Response, reqwest::Error>) -> Result<T, ApiError> {
    let res = sent.map_err(|e| {
        ApiError::Temporary(if e.is_timeout() {
            "Serverul nu a răspuns la timp.".into()
        } else {
            "Nu am putut ajunge la hsk.photos. Verifică legătura la internet.".into()
        })
    })?;
    let status = res.status();
    if status.is_success() {
        return res
            .json::<T>()
            .await
            .map_err(|_| ApiError::Temporary("Răspuns neașteptat de la server.".into()));
    }
    // FastAPI errors are {"detail": "..."}, already written for the photographer
    let detail = res
        .json::<Value>()
        .await
        .ok()
        .and_then(|v| v.get("detail").and_then(Value::as_str).map(String::from))
        .unwrap_or_else(|| format!("Serverul a răspuns cu eroarea {}.", status.as_u16()));
    Err(match status.as_u16() {
        401 => ApiError::Unauthorized(detail),
        429 | 500..=599 => ApiError::Temporary(detail),
        _ => ApiError::Rejected(detail),
    })
}

/// Trades the one-time pairing code for the session token. The code works once, for 5 minutes.
pub async fn claim(http: &reqwest::Client, code: &str, device: &str) -> Result<(String, Account), ApiError> {
    let sent = http
        .post(format!("{}/api/desktop/claim", base()))
        .timeout(SHORT)
        .json(&serde_json::json!({ "code": code, "device": device }))
        .send()
        .await;
    let c: Claimed = read(sent).await?;
    Ok((c.token, c.account))
}

pub async fn me(http: &reqwest::Client, token: &str) -> Result<Me, ApiError> {
    read(http.get(format!("{}/api/desktop/me", base())).timeout(SHORT).bearer_auth(token).send().await).await
}

/// The albums are passed to the window as the server sent them.
pub async fn albums(http: &reqwest::Client, token: &str) -> Result<Value, ApiError> {
    read(http.get(format!("{}/api/desktop/albums", base())).timeout(SHORT).bearer_auth(token).send().await).await
}

pub async fn sign_out(http: &reqwest::Client, token: &str) -> Result<(), ApiError> {
    let sent = http.delete(format!("{}/api/desktop/session", base())).timeout(SHORT).bearer_auth(token).send().await;
    read::<Value>(sent).await.map(|_| ())
}

/// Any call of the album panel's API, for the screens of the window. The path was checked by the caller.
pub async fn request(
    http: &reqwest::Client,
    token: &str,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<Value, ApiError> {
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| ApiError::Rejected("Metodă nepermisă.".into()))?;
    let mut req = http.request(method, format!("{}{}", base(), path)).timeout(SHORT).bearer_auth(token);
    if let Some(b) = body {
        req = req.json(&b);
    }
    read(req.send().await).await
}

/// A photo's original, written to `dest`.
pub async fn download(http: &reqwest::Client, token: &str, path: &str, dest: &std::path::Path) -> Result<(), ApiError> {
    let res = http
        .get(format!("{}{}", base(), path))
        .timeout(UPLOAD)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| ApiError::Temporary("Nu am putut ajunge la hsk.photos.".into()))?;
    if !res.status().is_success() {
        return Err(ApiError::Rejected(format!("Serverul a răspuns cu eroarea {}.", res.status().as_u16())));
    }
    let bytes = res.bytes().await.map_err(|_| ApiError::Temporary("Descărcarea s-a întrerupt.".into()))?;
    tokio::fs::write(dest, &bytes).await.map_err(|_| ApiError::Rejected("Nu am putut scrie fișierul pe disc.".into()))
}

/// A new version of a photo that is already in the album (same place, same address).
pub async fn replace(http: &reqwest::Client, token: &str, album: &str, photo: &str, body: Vec<u8>) -> Result<(), ApiError> {
    let sent = http
        .post(format!("{}/api/albums/{}/photos/{}/replace", base(), album, photo))
        .timeout(UPLOAD)
        .bearer_auth(token)
        .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
        .body(body)
        .send()
        .await;
    read::<Value>(sent).await.map(|_| ())
}

pub async fn upload(
    http: &reqwest::Client,
    token: &str,
    album: &str,
    filename: &str,
    body: Vec<u8>,
) -> Result<Uploaded, ApiError> {
    let mut url = url::Url::parse(&format!("{}/api/albums/{}/photos", base(), album))
        .map_err(|_| ApiError::Rejected("Codul albumului nu este valid.".into()))?;
    url.query_pairs_mut().append_pair("filename", filename);
    let sent = http
        .post(url)
        .timeout(UPLOAD)
        .bearer_auth(token)
        .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
        .body(body)
        .send()
        .await;
    read(sent).await
}
