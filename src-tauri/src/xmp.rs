//! Marks for the photographer's catalogue: stars and a colour label written to the .xmp sidecar of RAW files,
//! which Lightroom Classic and Capture One read when the folder is opened.

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Formats that keep their metadata in a sidecar file; JPEG and DNG carry it inside the file and are left alone.
const RAW: [&str; 10] = ["cr2", "cr3", "nef", "nrw", "arw", "raf", "orf", "rw2", "pef", "srw"];

#[derive(Serialize, Default)]
pub struct Report {
    pub marked: usize,
    pub missing: usize,
}

fn new_packet(rating: u8, label: &str) -> String {
    format!(
        "<?xpacket begin=\"\u{feff}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\"><rdf:Description rdf:about=\"\" xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\" xmp:Rating=\"{rating}\" xmp:Label=\"{label}\"/></rdf:RDF></x:xmpmeta>\n<?xpacket end=\"w\"?>\n"
    )
}

/// Sets `name="value"` on the first rdf:Description of an existing packet, keeping everything else (develop settings included).
fn set_attr(xml: &str, name: &str, value: &str) -> Option<String> {
    let key = format!("{name}=\"");
    if let Some(at) = xml.find(&key) {
        let from = at + key.len();
        let len = xml[from..].find('"')?;
        return Some(format!("{}{}{}", &xml[..from], value, &xml[from + len..]));
    }
    let tag = xml.find("<rdf:Description")?;
    let at = tag + "<rdf:Description".len();
    Some(format!("{} {name}=\"{value}\"{}", &xml[..at], &xml[at..]))
}

fn write_mark(raw: &Path, rating: u8, label: &str) -> bool {
    let side = raw.with_extension("xmp");
    let xml = match fs::read_to_string(&side) {
        Ok(old) => {
            let with_rating = set_attr(&old, "xmp:Rating", &rating.to_string());
            match with_rating.and_then(|x| set_attr(&x, "xmp:Label", label)) {
                Some(x) => x,
                None => return false,
            }
        }
        Err(_) => new_packet(rating, label),
    };
    let tmp = side.with_extension("xmp.tmp");
    fs::write(&tmp, xml).is_ok() && fs::rename(&tmp, &side).is_ok()
}

fn raw_files(folder: &Path) -> HashMap<String, Vec<PathBuf>> {
    let mut found: HashMap<String, Vec<PathBuf>> = HashMap::new();
    let mut stack = vec![folder.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            match entry.file_type() {
                Ok(t) if t.is_dir() => stack.push(path),
                Ok(t) if t.is_file() => {
                    let ext = path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
                    if RAW.contains(&ext.as_str()) {
                        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                            found.entry(stem.to_lowercase()).or_default().push(path);
                        }
                    }
                }
                _ => {}
            }
        }
    }
    found
}

/// `names` are file names without extension, as the album knows them.
pub fn mark(folder: &Path, names: &[String], rating: u8, label: &str) -> Report {
    let files = raw_files(folder);
    let mut report = Report::default();
    for name in names {
        match files.get(&name.to_lowercase()) {
            Some(list) if list.iter().map(|p| write_mark(p, rating, label)).fold(false, |a, b| a | b) => report.marked += 1,
            _ => report.missing += 1,
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attributes_are_set_or_added() {
        let packet = new_packet(1, "Red");
        let x = set_attr(&packet, "xmp:Rating", "5").unwrap();
        assert!(x.contains("xmp:Rating=\"5\"") && x.contains("xmp:Label=\"Red\""));
        let y = set_attr("<rdf:Description a=\"1\"/>", "xmp:Label", "Green").unwrap();
        assert_eq!(y, "<rdf:Description xmp:Label=\"Green\" a=\"1\"/>");
        assert!(set_attr("<nothing/>", "xmp:Label", "Green").is_none());
    }

    #[test]
    fn raw_files_get_a_sidecar() {
        let dir = std::env::temp_dir().join("hsk-xmp-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("sub/IMG_1.CR3"), b"x").unwrap();
        fs::write(dir.join("IMG_2.jpg"), b"x").unwrap();
        let r = mark(&dir, &["img_1".into(), "IMG_2".into(), "IMG_3".into()], 5, "Green");
        assert_eq!((r.marked, r.missing), (1, 2));
        assert!(fs::read_to_string(dir.join("sub/IMG_1.xmp")).unwrap().contains("xmp:Rating=\"5\""));
        let _ = fs::remove_dir_all(&dir);
    }
}
