//! The local catalogue: names, dates and camera data of the files on the photographer's disks, kept as a small
//! list so a search works while the disks are unplugged. The files themselves are never touched.

use crate::inbox::day_of;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

const EXTENSIONS: [&str; 17] = ["jpg", "jpeg", "png", "tif", "tiff", "heic", "cr2", "cr3", "nef", "nrw", "arw", "raf", "orf", "rw2", "pef", "srw", "dng"];

#[derive(Clone, Serialize, Deserialize)]
pub struct Root {
    pub id: String,
    pub label: String,
    pub path: PathBuf,
    pub files: usize,
    pub updated: u64,
}

#[derive(Serialize)]
pub struct RootInfo {
    #[serde(flatten)]
    root: Root,
    online: bool,
}

/// One file: name, folder under the root, date taken, camera, lens.
#[derive(Clone, Serialize, Deserialize)]
pub struct Entry {
    n: String,
    d: String,
    t: String,
    c: String,
    l: String,
}

#[derive(Serialize)]
pub struct Hit {
    name: String,
    taken: String,
    camera: String,
    folder: String,
    root: String,
    online: bool,
}

#[derive(Serialize, Default)]
pub struct Found {
    total: usize,
    hits: Vec<Hit>,
}

#[derive(Default)]
pub struct Catalog {
    dir: Mutex<Option<PathBuf>>,
    roots: Mutex<Vec<Root>>,
    entries: Mutex<HashMap<String, Vec<Entry>>>,
}

fn ascii(f: &exif::Field) -> String {
    match &f.value {
        exif::Value::Ascii(v) => v.first().map(|b| String::from_utf8_lossy(b).trim().to_string()).unwrap_or_default(),
        _ => String::new(),
    }
}

/// "2024:06:15 16:42:10" -> "2024-06-15 16:42"
fn tidy_date(raw: &str) -> String {
    let b = raw.as_bytes();
    if b.len() >= 16 && b[4] == b':' && b[7] == b':' {
        format!("{}-{}-{} {}", &raw[..4], &raw[5..7], &raw[8..10], &raw[11..16])
    } else {
        String::new()
    }
}

fn read_entry(root: &Path, file: &Path) -> Entry {
    let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let folder = file.parent().and_then(|p| p.strip_prefix(root).ok()).map(|p| p.display().to_string()).unwrap_or_default();
    let (mut taken, mut camera, mut lens) = (String::new(), String::new(), String::new());
    if let Ok(f) = fs::File::open(file) {
        if let Ok(x) = exif::Reader::new().read_from_container(&mut BufReader::new(f)) {
            if let Some(v) = x.get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY) {
                taken = tidy_date(&ascii(v));
            }
            if let Some(v) = x.get_field(exif::Tag::Model, exif::In::PRIMARY) {
                camera = ascii(v);
            }
            if let Some(v) = x.get_field(exif::Tag::LensModel, exif::In::PRIMARY) {
                lens = ascii(v);
            }
        }
    }
    if taken.is_empty() {
        let secs = fs::metadata(file).ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
        taken = day_of(secs);
    }
    Entry { n: name, d: folder, t: taken, c: camera, l: lens }
}

/// Walks the root and lists its photo files; `progress` is told the count every few hundred files.
pub fn scan(root: &Path, mut progress: impl FnMut(usize)) -> Vec<Entry> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(items) = fs::read_dir(&dir) else { continue };
        for item in items.flatten() {
            let path = item.path();
            if path.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')) {
                continue;
            }
            match item.file_type() {
                Ok(t) if t.is_dir() => stack.push(path),
                Ok(t) if t.is_file() => {
                    let ext = path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
                    if EXTENSIONS.contains(&ext.as_str()) {
                        out.push(read_entry(root, &path));
                        if out.len() % 500 == 0 {
                            progress(out.len());
                        }
                    }
                }
                _ => {}
            }
        }
    }
    out
}

impl Catalog {
    pub fn open(&self, dir: PathBuf) {
        let _ = fs::create_dir_all(&dir);
        *self.roots.lock().unwrap() = fs::read(dir.join("roots.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        *self.dir.lock().unwrap() = Some(dir);
    }

    fn dir(&self) -> Option<PathBuf> {
        self.dir.lock().unwrap().clone()
    }

    fn save_roots(&self) {
        if let Some(dir) = self.dir() {
            if let Ok(b) = serde_json::to_vec_pretty(&*self.roots.lock().unwrap()) {
                let _ = fs::write(dir.join("roots.json"), b);
            }
        }
    }

    pub fn roots(&self) -> Vec<RootInfo> {
        self.roots.lock().unwrap().iter().map(|r| RootInfo { online: r.path.is_dir(), root: r.clone() }).collect()
    }

    pub fn find(&self, id: &str) -> Option<Root> {
        self.roots.lock().unwrap().iter().find(|r| r.id == id).cloned()
    }

    pub fn new_id() -> String {
        format!("{:x}", std::time::SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_nanos()))
    }

    /// Stores a finished scan: the entries on disk and in memory, the root in the list.
    pub fn put(&self, mut root: Root, entries: Vec<Entry>) {
        root.files = entries.len();
        root.updated = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
        if let (Some(dir), Ok(b)) = (self.dir(), serde_json::to_vec(&entries)) {
            let _ = fs::write(dir.join(format!("{}.json", root.id)), b);
        }
        self.entries.lock().unwrap().insert(root.id.clone(), entries);
        let mut roots = self.roots.lock().unwrap();
        match roots.iter_mut().find(|r| r.id == root.id) {
            Some(old) => *old = root,
            None => roots.push(root),
        }
        drop(roots);
        self.save_roots();
    }

    pub fn remove(&self, id: &str) {
        self.roots.lock().unwrap().retain(|r| r.id != id);
        self.entries.lock().unwrap().remove(id);
        if let Some(dir) = self.dir() {
            let _ = fs::remove_file(dir.join(format!("{id}.json")));
        }
        self.save_roots();
    }

    fn load(&self, id: &str) {
        if self.entries.lock().unwrap().contains_key(id) {
            return;
        }
        let list = self.dir().and_then(|d| fs::read(d.join(format!("{id}.json"))).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        self.entries.lock().unwrap().insert(id.to_string(), list);
    }

    /// Every word of the query must appear in the name, the date, the camera, the lens or the folder.
    pub fn search(&self, query: &str, limit: usize) -> Found {
        let words: Vec<String> = query.to_lowercase().split_whitespace().map(String::from).collect();
        let roots = self.roots.lock().unwrap().clone();
        let (mut total, mut hits) = (0, Vec::new());
        for r in &roots {
            self.load(&r.id);
            let online = r.path.is_dir();
            let all = self.entries.lock().unwrap();
            for e in all.get(&r.id).into_iter().flatten() {
                let hay = format!("{} {} {} {} {}", e.n, e.t, e.c, e.l, e.d).to_lowercase();
                if words.iter().all(|w| hay.contains(w)) {
                    total += 1;
                    if hits.len() < limit {
                        hits.push(Hit { name: e.n.clone(), taken: e.t.clone(), camera: e.c.clone(), folder: e.d.clone(), root: r.label.clone(), online });
                    }
                }
            }
        }
        Found { total, hits }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exif_dates_are_tidied() {
        assert_eq!(tidy_date("2024:06:15 16:42:10"), "2024-06-15 16:42");
        assert_eq!(tidy_date("nu e dată"), "");
    }

    #[test]
    fn scanned_files_are_found_by_any_word() {
        let dir = std::env::temp_dir().join("hsk-catalog-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("Nunta Radu")).unwrap();
        fs::write(dir.join("Nunta Radu/IMG_4821.CR3"), b"not really raw").unwrap();
        fs::write(dir.join("Nunta Radu/notes.txt"), b"x").unwrap();
        let entries = scan(&dir, |_| {});
        assert_eq!(entries.len(), 1);
        let cat = Catalog::default();
        cat.put(Root { id: "t".into(), label: "Test".into(), path: dir.clone(), files: 0, updated: 0 }, entries);
        assert_eq!(cat.search("4821 radu", 10).total, 1);
        assert_eq!(cat.search("zzz", 10).total, 0);
        let _ = fs::remove_dir_all(&dir);
    }
}
