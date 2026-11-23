// Updates: the newest published release on GitHub, compared with this build. The app downloads the file for this
// computer, checks it against the SHA-256 GitHub lists for it, and installs it:
// Windows: our setup (hsk-studio-setup-<v>.exe) runs with --update into the same folder, and the app closes.
// macOS: the .app from the universal .dmg replaces this one, and the app starts again.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use tauri::{AppHandle, Emitter};

const LATEST: &str = "https://api.github.com/repos/hsk720/hsk.-studio-companion/releases/latest";

#[derive(Serialize, Clone, Default)]
pub struct Update {
    available: bool,
    current: String,
    version: String,
    notes: String,
    url: String,
    name: String,
    size: u64,
    digest: Option<String>,
    page: String,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    body: Option<String>,
    html_url: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
    #[serde(default)]
    digest: Option<String>, // "sha256:<hex>"
}

#[derive(Serialize, Clone)]
struct Progress {
    done: u64,
    total: u64,
}

fn http(app: &AppHandle) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(format!("hsk-studio/{}", app.package_info().version))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())
}

/// "v0.4.10" → (0, 4, 10); anything after a '-' or '+' is ignored.
fn version(v: &str) -> (u64, u64, u64) {
    let core = v.trim().trim_start_matches('v').split(['-', '+']).next().unwrap_or("");
    let mut n = core.split('.').map(|p| p.parse::<u64>().unwrap_or(0));
    (n.next().unwrap_or(0), n.next().unwrap_or(0), n.next().unwrap_or(0))
}

/// The release file this computer installs from.
fn fits(name: &str) -> bool {
    let n = name.to_lowercase();
    if cfg!(target_os = "windows") {
        n.starts_with("hsk-studio-setup") && n.ends_with(".exe")
    } else if cfg!(target_os = "macos") {
        n.ends_with(".dmg")
    } else {
        false
    }
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Update, String> {
    let current = app.package_info().version.to_string();
    let rel: Release = http(&app)?
        .get(LATEST)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| "Nu am putut verifica actualizările. Verifică internetul.".to_string())?
        .error_for_status()
        .map_err(|e| format!("GitHub a răspuns cu eroarea {}.", e.status().map(|s| s.as_u16()).unwrap_or(0)))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let mut up = Update { current: current.clone(), version: rel.tag_name.trim_start_matches('v').to_string(), page: rel.html_url, ..Default::default() };
    if rel.draft || rel.prerelease || version(&rel.tag_name) <= version(&current) {
        return Ok(up);
    }
    // the release is listed before its files are attached: no file for this computer yet means no update yet
    if let Some(a) = rel.assets.into_iter().find(|a| fits(&a.name)) {
        up.available = true;
        up.notes = rel.body.unwrap_or_default();
        up.url = a.browser_download_url;
        up.name = a.name;
        up.size = a.size;
        up.digest = a.digest;
    }
    Ok(up)
}

/// Downloads, checks and starts the installation. Returns "restart" when the app is about to close for it.
#[tauri::command]
pub async fn update_install(app: AppHandle, url: String, name: String, digest: Option<String>) -> Result<String, String> {
    if !url.starts_with("https://github.com/hsk720/hsk.-studio-companion/releases/download/") || name.contains(['/', '\\']) {
        return Err("Adresa actualizării nu e cea a aplicației.".into());
    }
    let dir = std::env::temp_dir().join("hsk-studio-update");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(&name);
    download(&app, &url, &file, digest.as_deref()).await?;
    install(&app, &file)
}

async fn download(app: &AppHandle, url: &str, file: &Path, digest: Option<&str>) -> Result<(), String> {
    use std::io::Write;
    let mut res = http(app)?
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|_| "Descărcarea actualizării nu a pornit. Încearcă din nou.".to_string())?;
    let total = res.content_length().unwrap_or(0);
    let mut out = std::fs::File::create(file).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut done = 0u64;
    let mut last = std::time::Instant::now();
    while let Some(chunk) = res.chunk().await.map_err(|_| "Descărcarea s-a întrerupt. Încearcă din nou.".to_string())? {
        out.write_all(&chunk).map_err(|e| e.to_string())?;
        hash.update(&chunk);
        done += chunk.len() as u64;
        if last.elapsed().as_millis() > 120 {
            let _ = app.emit("update-progress", Progress { done, total });
            last = std::time::Instant::now();
        }
    }
    out.flush().map_err(|e| e.to_string())?;
    let _ = app.emit("update-progress", Progress { done, total });
    if let Some(want) = digest.and_then(|d| d.strip_prefix("sha256:")) {
        let got = hash.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>();
        if !got.eq_ignore_ascii_case(want) {
            let _ = std::fs::remove_file(file);
            return Err("Fișierul descărcat nu se potrivește cu cel publicat. Nu l-am instalat.".into());
        }
    }
    Ok(())
}

/// After the reply reaches the window, the app closes so the new version can take its place.
#[cfg_attr(not(any(target_os = "windows", target_os = "macos")), allow(dead_code))]
fn quit_soon(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(600));
        app.exit(0);
    });
}

#[cfg(target_os = "windows")]
fn install(app: &AppHandle, file: &Path) -> Result<String, String> {
    // into the folder this copy runs from, so a custom folder stays the same
    let here = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf));
    let mut cmd = std::process::Command::new(file);
    cmd.arg("--update");
    if let Some(dir) = here {
        cmd.arg("--dir").arg(dir);
    }
    cmd.spawn().map_err(|e| format!("Actualizarea nu a pornit: {e}"))?;
    quit_soon(app);
    Ok("restart".into())
}

#[cfg(target_os = "macos")]
fn install(app: &AppHandle, file: &Path) -> Result<String, String> {
    use std::process::Command;
    // this copy: …/hsk. studio.app/Contents/MacOS/hsk. studio
    let bundle = std::env::current_exe().ok().and_then(|p| p.ancestors().nth(3).map(Path::to_path_buf)).filter(|p| p.extension().is_some_and(|e| e == "app"));
    let opened_by_hand = || -> Result<String, String> {
        Command::new("open").arg(file).spawn().map_err(|e| e.to_string())?;
        Ok("manual".into())
    };
    let Some(bundle) = bundle else { return opened_by_hand() };
    let mount = std::env::temp_dir().join(format!("hsk-studio-dmg-{}", std::process::id()));
    let attached = Command::new("hdiutil").args(["attach", "-nobrowse", "-readonly", "-quiet", "-mountpoint"]).arg(&mount).arg(file).status();
    if !attached.is_ok_and(|s| s.success()) {
        return opened_by_hand();
    }
    let detach = || {
        let _ = Command::new("hdiutil").args(["detach", "-quiet"]).arg(&mount).status();
    };
    let source = std::fs::read_dir(&mount).ok().and_then(|d| d.flatten().map(|e| e.path()).find(|p| p.extension().is_some_and(|e| e == "app")));
    let Some(source) = source else {
        detach();
        return opened_by_hand();
    };
    // copy next to the old app, then swap: the old one is removed only once the new one is in place
    let parent = bundle.parent().map(Path::to_path_buf).unwrap_or_else(|| std::path::PathBuf::from("/Applications"));
    let fresh = parent.join(".hsk-studio-update.app");
    let old = parent.join(".hsk-studio-old.app");
    let _ = std::fs::remove_dir_all(&fresh);
    let _ = std::fs::remove_dir_all(&old);
    let copied = Command::new("ditto").arg(&source).arg(&fresh).status().is_ok_and(|s| s.success());
    detach();
    if !copied || std::fs::rename(&bundle, &old).is_err() {
        let _ = std::fs::remove_dir_all(&fresh);
        return opened_by_hand();
    }
    if std::fs::rename(&fresh, &bundle).is_err() {
        let _ = std::fs::rename(&old, &bundle);
        return opened_by_hand();
    }
    let _ = std::fs::remove_dir_all(&old);
    let _ = std::fs::remove_file(file);
    Command::new("open").arg("-n").arg(&bundle).spawn().map_err(|e| e.to_string())?;
    quit_soon(app);
    Ok("restart".into())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn install(_app: &AppHandle, _file: &Path) -> Result<String, String> {
    Err("Pe acest sistem, actualizarea se instalează de mână.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_by_number() {
        assert!(version("v0.4.10") > version("0.4.9"));
        assert!(version("v1.0.0") > version("0.9.99"));
        assert_eq!(version("v0.4.4"), version("0.4.4"));
        assert_eq!(version("0.5.0-beta.1"), (0, 5, 0));
    }

    #[test]
    fn only_this_computers_file_fits() {
        if cfg!(target_os = "windows") {
            assert!(fits("hsk-studio-setup-0.4.4.exe"));
            assert!(!fits("hsk.studio_0.4.4_x64-setup.exe"));
        }
        if cfg!(target_os = "macos") {
            assert!(fits("hsk.studio_0.4.4_universal.dmg"));
        }
        assert!(!fits("notes.txt"));
    }
}
