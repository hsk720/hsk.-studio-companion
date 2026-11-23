// hsk. studio Setup: the installer people see on Windows. The window is ours (the hsk. look, ../ui); the work is
// done by the real installer, Tauri's NSIS setup of hsk. studio, carried inside this program and run silently.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

/// The NSIS setup of hsk. studio, copied into payload/ by the build (empty in a local check).
static PAYLOAD: &[u8] = include_bytes!("../payload/setup-nsis.exe");
const APP_NAME: &str = "hsk. studio";

#[derive(Serialize)]
struct Info {
    dir: String,
    version: String,
    /// hsk. studio is already in the usual folder: the window says "update" instead of "install"
    update: bool,
}

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Serialize, Clone)]
struct Progress {
    step: &'static str, // files | install | shortcuts | done
    percent: u8,
}

fn default_dir() -> PathBuf {
    // where the NSIS setup installs for the current user, without asking for administrator rights
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    base.join(APP_NAME)
}

/// The program inside an installed folder: the one .exe that is not the uninstaller.
fn main_exe(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).find(|p| {
        p.extension().is_some_and(|x| x.eq_ignore_ascii_case("exe"))
            && !p.file_name().unwrap_or_default().to_string_lossy().to_lowercase().starts_with("uninstall")
    })
}

#[tauri::command]
fn info(app: AppHandle) -> Info {
    let dir = default_dir();
    Info { update: main_exe(&dir).is_some(), dir: dir.to_string_lossy().into(), version: app.package_info().version.to_string() }
}

/// A folder chosen in the picker: the app goes into its own "hsk. studio" folder inside it.
#[tauri::command]
fn folder_for(picked: String) -> String {
    let p = PathBuf::from(&picked);
    if p.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(APP_NAME)) { picked } else { p.join(APP_NAME).to_string_lossy().into() }
}

/// Installs into `dir`, then sets the desktop shortcut and the start with Windows as chosen. Returns the program's path.
#[tauri::command]
async fn install(app: AppHandle, dir: String, desktop: bool, autostart: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run_install(&app, Path::new(&dir), desktop, autostart))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg_attr(not(windows), allow(dead_code))]
fn say(app: &AppHandle, step: &'static str, percent: u8) {
    let _ = app.emit("progress", Progress { step, percent });
}

#[cfg(windows)]
fn run_install(app: &AppHandle, dir: &Path, desktop: bool, autostart: bool) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    use std::time::{Duration, Instant};
    if PAYLOAD.is_empty() {
        return Err("Programul de instalare e incomplet. Descarcă-l din nou de pe hsk.photos.".into());
    }
    say(app, "files", 4);
    let tmp = std::env::temp_dir().join(format!("hsk-studio-setup-{}.exe", std::process::id()));
    std::fs::write(&tmp, PAYLOAD).map_err(|e| format!("Nu am putut pregăti fișierele: {e}"))?;
    say(app, "install", 12);

    // NSIS wants /D= last and unquoted, even with spaces in the path
    let mut child = std::process::Command::new(&tmp)
        .arg("/S")
        .raw_arg(format!("/D={}", dir.display()))
        .spawn()
        .map_err(|e| format!("Instalarea nu a pornit: {e}"))?;
    let start = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break s;
        }
        // the silent setup does not report progress: the bar follows the usual few seconds and slows before the end
        let t = start.elapsed().as_secs_f64();
        say(app, "install", (12.0 + 76.0 * (1.0 - (-t / 5.0).exp())) as u8);
        std::thread::sleep(Duration::from_millis(150));
    };
    let _ = std::fs::remove_file(&tmp);
    if !status.success() {
        return Err(format!("Instalarea s-a oprit (cod {}). Închide hsk. studio dacă e deschis și încearcă din nou.", status.code().unwrap_or(-1)));
    }
    let exe = main_exe(dir).ok_or("Instalarea s-a terminat, dar nu găsesc aplicația în folder.")?;

    say(app, "shortcuts", 92);
    let link = std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join("Desktop").join(format!("{APP_NAME}.lnk")));
    if let Some(link) = link {
        if desktop {
            if !link.exists() {
                if let Ok(l) = mslnk::ShellLink::new(&exe) {
                    let _ = l.create_lnk(&link);
                }
            }
        } else {
            let _ = std::fs::remove_file(&link);
        }
    }
    // the same entry the app's own "Pornește odată cu calculatorul" switch writes (tauri-plugin-autostart)
    let run = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")
        .map(|(k, _)| k);
    if let Ok(run) = run {
        if autostart {
            let _ = run.set_value(APP_NAME, &format!("\"{}\" --hidden", exe.display()));
        } else {
            let _ = run.delete_value(APP_NAME);
        }
    }
    say(app, "done", 100);
    Ok(exe.to_string_lossy().into())
}

#[cfg(not(windows))]
fn run_install(_app: &AppHandle, _dir: &Path, _desktop: bool, _autostart: bool) -> Result<String, String> {
    let _ = PAYLOAD.len();
    Err("Programul acesta instalează hsk. studio pe Windows.".into())
}

#[tauri::command]
fn launch(exe: String) -> Result<(), String> {
    std::process::Command::new(exe).spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![info, folder_for, install, launch])
        .run(tauri::generate_context!())
        .expect("hsk. studio Setup");
}
