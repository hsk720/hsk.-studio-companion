//! The photographer's editor: Lightroom Classic, Capture One, Photoshop, any other program, or the system's default.
//! The photos to edit are opened in it straight from the app, so one app does what two used to.

use std::path::{Path, PathBuf};
use std::process::Command;

/// The name shown in the window for a choice of editor.
pub fn label(kind: &str, path: Option<&Path>) -> String {
    match kind {
        "lightroom" => "Lightroom Classic".into(),
        "captureone" => "Capture One".into(),
        "photoshop" => "Photoshop".into(),
        "custom" => path.and_then(|p| p.file_stem()).map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
        _ => String::new(),
    }
}

fn entries(dir: &Path) -> Vec<PathBuf> {
    let mut list: Vec<PathBuf> = std::fs::read_dir(dir).map(|r| r.flatten().map(|e| e.path()).collect()).unwrap_or_default();
    list.sort();
    list.reverse(); // the newest version name sorts last
    list
}

fn starts(p: &Path, prefix: &str) -> bool {
    p.file_name().is_some_and(|n| n.to_string_lossy().to_lowercase().starts_with(&prefix.to_lowercase()))
}

/// Where the program is usually installed. None when it is not found: the window then asks for it.
pub fn detect(kind: &str) -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        let apps = Path::new("/Applications");
        return match kind {
            "lightroom" => entries(apps).into_iter().filter(|d| starts(d, "Adobe Lightroom Classic")).find_map(|d| entries(&d).into_iter().find(|a| starts(a, "Adobe Lightroom Classic") && a.extension().is_some_and(|e| e == "app"))),
            "photoshop" => entries(apps).into_iter().filter(|d| starts(d, "Adobe Photoshop")).find_map(|d| entries(&d).into_iter().find(|a| starts(a, "Adobe Photoshop") && a.extension().is_some_and(|e| e == "app"))),
            "captureone" => entries(apps).into_iter().find(|a| starts(a, "Capture One") && a.extension().is_some_and(|e| e == "app")),
            _ => None,
        };
    }
    if cfg!(target_os = "windows") {
        let files = PathBuf::from(std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into()));
        return match kind {
            "lightroom" => entries(&files.join("Adobe")).into_iter().filter(|d| starts(d, "Adobe Lightroom Classic")).map(|d| d.join("Lightroom.exe")).find(|p| p.is_file()),
            "photoshop" => entries(&files.join("Adobe")).into_iter().filter(|d| starts(d, "Adobe Photoshop")).map(|d| d.join("Photoshop.exe")).find(|p| p.is_file()),
            "captureone" => entries(&files).into_iter().filter(|d| starts(d, "Capture One")).find_map(|d| {
                let direct = d.join("CaptureOne.exe");
                if direct.is_file() { Some(direct) } else { entries(&d).into_iter().map(|v| v.join("CaptureOne.exe")).find(|p| p.is_file()) }
            }),
            _ => None,
        };
    }
    None
}

/// Opens the files in the chosen program, or in the system's default one when none is chosen.
pub fn launch(program: Option<&Path>, files: &[PathBuf]) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let failed = || "Nu am putut deschide editorul. Alege-l din nou în Setări.".to_string();
    match program {
        Some(p) if cfg!(target_os = "macos") => Command::new("open").arg("-a").arg(p).args(files).spawn().map(|_| ()).map_err(|_| failed()),
        Some(p) => Command::new(p).args(files).spawn().map(|_| ()).map_err(|_| failed()),
        None if cfg!(target_os = "macos") => Command::new("open").args(files).spawn().map(|_| ()).map_err(|_| failed()),
        None if cfg!(target_os = "windows") => Command::new("cmd").arg("/C").arg("start").arg("").arg(&files[0]).spawn().map(|_| ()).map_err(|_| failed()),
        None => Command::new("xdg-open").arg(&files[0]).spawn().map(|_| ()).map_err(|_| failed()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_follow_the_choice() {
        assert_eq!(label("lightroom", None), "Lightroom Classic");
        assert_eq!(label("custom", Some(Path::new("/Applications/Affinity Photo 2.app"))), "Affinity Photo 2");
        assert_eq!(label("system", None), "");
    }

    #[test]
    fn unknown_kinds_are_not_detected() {
        assert!(detect("nimic").is_none());
    }
}
