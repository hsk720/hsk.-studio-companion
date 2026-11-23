//! Selecție: looks at a card of fresh frames on this computer and measures what a photographer checks first.
//! Every RAW carries a full-size JPEG made by the camera; that is what gets measured, so no RAW decoder is needed.
//! Per frame: sharpness (the sharpest part of the frame, so a portrait with a soft background still counts as
//! sharp), burnt or black frames, a small fingerprint to find the frames of a burst, and the time it was taken.
//! Faces and closed eyes are found in the window (MediaPipe), on the preview written here.
//! Nothing leaves the computer; nothing on the card changes until the photographer applies the selection,
//! and even then the dropped frames are only moved into a "Respinse" subfolder.

use base64::Engine;
use image::imageops::FilterType;
use image::{DynamicImage, GrayImage, ImageDecoder, ImageFormat, ImageReader};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{BufReader, Cursor};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

const RAW: [&str; 11] = ["cr2", "cr3", "nef", "nrw", "arw", "raf", "orf", "rw2", "pef", "srw", "dng"];
const JPEG: [&str; 2] = ["jpg", "jpeg"];
/// The subfolder the dropped frames go to. Never scanned.
pub const REJECTED: &str = "Respinse";
/// Measuring size: enough to tell a sharp eyelash from a soft one, small enough for a card of 2,000 frames.
const MEASURE: u32 = 1280;
/// The picture shown in the window and given to the eye check.
const VIEW: u32 = 1600;
const THUMB: u32 = 200;

#[derive(Serialize, Clone, Debug)]
pub struct Frame {
    /// file name as on the card (IMG_4801.CR3)
    pub name: String,
    pub path: PathBuf,
    /// small JPEG for the strip, as a data: address
    pub src: String,
    /// seconds since midnight, with the fraction when the camera writes it
    pub t: f64,
    pub burst: Option<usize>,
    /// 0..1, 1 = crisp somewhere in the frame
    pub sharp: f64,
    /// 0..1, the share of the frame that is burnt white or crushed black
    pub clip: f64,
    #[serde(skip)]
    hash: u64,
    #[serde(skip)]
    stamp: f64,
}

#[derive(Serialize, Default)]
pub struct Moved {
    pub moved: usize,
    pub missing: usize,
}

fn ext_of(p: &Path) -> String {
    p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default()
}

/// The frames of a card: RAW files, and JPEGs that have no RAW twin (RAW+JPEG cards show one frame).
pub fn list(folder: &Path) -> Vec<PathBuf> {
    let mut by_stem: HashMap<(PathBuf, String), PathBuf> = HashMap::new();
    let mut stack = vec![folder.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name.starts_with('~') {
                continue;
            }
            match entry.file_type() {
                Ok(t) if t.is_dir() => {
                    if name != REJECTED {
                        stack.push(path)
                    }
                }
                Ok(t) if t.is_file() => {
                    let ext = ext_of(&path);
                    let raw = RAW.contains(&ext.as_str());
                    if !raw && !JPEG.contains(&ext.as_str()) {
                        continue;
                    }
                    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
                    let key = (dir.clone(), stem);
                    match by_stem.get(&key) {
                        Some(old) if RAW.contains(&ext_of(old).as_str()) => {}
                        _ if raw || !by_stem.contains_key(&key) => {
                            by_stem.insert(key, path);
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }
    let mut out: Vec<PathBuf> = by_stem.into_values().collect();
    out.sort();
    out
}

/// The biggest JPEG inside a RAW file (the camera's full-size preview). Small thumbnails and the lossless
/// "JPEG" some cameras use for the raw data itself are skipped: they either decode smaller or not at all.
pub fn embedded_jpeg(bytes: &[u8]) -> Option<DynamicImage> {
    let mut found: Vec<(u64, usize)> = Vec::new();
    let mut at = 0;
    while let Some(i) = bytes[at..].windows(3).position(|w| w == [0xFF, 0xD8, 0xFF]) {
        let pos = at + i;
        let reader = ImageReader::with_format(Cursor::new(&bytes[pos..]), ImageFormat::Jpeg);
        if let Ok((w, h)) = reader.into_dimensions() {
            if w >= 160 && h >= 120 {
                found.push((w as u64 * h as u64, pos));
            }
        }
        at = pos + 3;
        if found.len() > 40 {
            break;
        }
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().find_map(|(_, pos)| {
        let reader = ImageReader::with_format(Cursor::new(&bytes[pos..]), ImageFormat::Jpeg);
        reader.decode().ok()
    })
}

struct Meta {
    stamp: Option<f64>,
    orientation: u32,
}

/// Time taken (seconds since 1970 in the camera's clock, with the fraction) and orientation, from the EXIF.
/// Formats the EXIF reader does not know (CR3, RAF) fall back to the date text found in the file's first bytes.
fn meta(path: &Path, head: &[u8]) -> Meta {
    let mut m = Meta { stamp: None, orientation: 1 };
    if let Ok(f) = fs::File::open(path) {
        if let Ok(x) = exif::Reader::new().read_from_container(&mut BufReader::new(f)) {
            let text = |tag| x.get_field(tag, exif::In::PRIMARY).map(|f| match &f.value {
                exif::Value::Ascii(v) => v.first().map(|b| String::from_utf8_lossy(b).trim().to_string()).unwrap_or_default(),
                _ => f.display_value().to_string(),
            });
            if let Some(o) = x.get_field(exif::Tag::Orientation, exif::In::PRIMARY).and_then(|f| f.value.get_uint(0)) {
                m.orientation = o;
            }
            if let Some(d) = text(exif::Tag::DateTimeOriginal) {
                let sub = text(exif::Tag::SubSecTimeOriginal).unwrap_or_default();
                m.stamp = parse_stamp(&d, &sub);
            }
        }
    }
    if m.stamp.is_none() {
        m.stamp = find_date(head);
    }
    m
}

/// "2026:11:08 13:20:01" plus "45" → seconds, 13:20:01.45 on that day.
fn parse_stamp(d: &str, sub: &str) -> Option<f64> {
    let d = d.trim();
    if d.len() < 19 {
        return None;
    }
    let n = |r: std::ops::Range<usize>| d.get(r).and_then(|s| s.parse::<i64>().ok());
    let (y, mo, da, h, mi, s) = (n(0..4)?, n(5..7)?, n(8..10)?, n(11..13)?, n(14..16)?, n(17..19)?);
    let date = chrono::NaiveDate::from_ymd_opt(y as i32, mo as u32, da as u32)?;
    let days = date.signed_duration_since(chrono::NaiveDate::from_ymd_opt(1970, 1, 1)?).num_days();
    let frac = if sub.chars().all(|c| c.is_ascii_digit()) && !sub.is_empty() { format!("0.{sub}").parse::<f64>().unwrap_or(0.0) } else { 0.0 };
    Some((days * 86400 + h * 3600 + mi * 60 + s) as f64 + frac)
}

fn find_date(head: &[u8]) -> Option<f64> {
    head.windows(19).find_map(|w| {
        let ok = w.iter().enumerate().all(|(i, &c)| match i {
            4 | 7 => c == b':',
            10 => c == b' ',
            13 | 16 => c == b':',
            _ => c.is_ascii_digit(),
        });
        if ok { parse_stamp(std::str::from_utf8(w).ok()?, "") } else { None }
    })
}

/// Sharpness: variance of the Laplacian in a 6×6 grid of tiles, the mean of the three sharpest tiles.
/// One crisp tile can be noise; three mean a part of the frame is really in focus. 0..1 after the curve.
pub fn sharpness(g: &GrayImage) -> f64 {
    let (w, h) = (g.width() as usize, g.height() as usize);
    if w < 24 || h < 24 {
        return 0.0;
    }
    let px = |x: usize, y: usize| g.as_raw()[y * w + x] as f64;
    let n = 6;
    let mut tiles = Vec::with_capacity(n * n);
    for ty in 0..n {
        for tx in 0..n {
            let (x0, x1) = ((tx * w / n).max(1), ((tx + 1) * w / n).min(w - 1));
            let (y0, y1) = ((ty * h / n).max(1), ((ty + 1) * h / n).min(h - 1));
            let (mut s, mut s2, mut c) = (0.0, 0.0, 0.0);
            for y in y0..y1 {
                for x in x0..x1 {
                    let l = px(x - 1, y) + px(x + 1, y) + px(x, y - 1) + px(x, y + 1) - 4.0 * px(x, y);
                    s += l;
                    s2 += l * l;
                    c += 1.0;
                }
            }
            if c > 0.0 {
                let m = s / c;
                tiles.push(s2 / c - m * m);
            }
        }
    }
    tiles.sort_by(|a, b| b.partial_cmp(a).unwrap());
    let top = tiles.iter().take(3).sum::<f64>() / 3.0;
    1.0 - (-top / SHARP_K).exp()
}
/// Where the curve bends: a frame with this much detail in its best tiles scores 0.63.
const SHARP_K: f64 = 160.0;

/// Share of the frame burnt to white or crushed to black (the larger of the two).
pub fn clipping(g: &GrayImage) -> f64 {
    let all = g.as_raw().len().max(1) as f64;
    let hi = g.as_raw().iter().filter(|&&v| v >= 250).count() as f64 / all;
    let lo = g.as_raw().iter().filter(|&&v| v <= 4).count() as f64 / all;
    hi.max(lo)
}

/// 64-bit difference hash: frames of the same moment differ in a few bits.
pub fn dhash(img: &DynamicImage) -> u64 {
    let small = img.resize_exact(9, 8, FilterType::Triangle).to_luma8();
    let mut h = 0u64;
    for y in 0..8 {
        for x in 0..8 {
            h = (h << 1) | (small.get_pixel(x, y)[0] < small.get_pixel(x + 1, y)[0]) as u64;
        }
    }
    h
}

fn jpeg_data(img: &DynamicImage, quality: u8) -> Vec<u8> {
    let mut out = Vec::new();
    let enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality);
    let _ = DynamicImage::ImageRgb8(img.to_rgb8()).write_with_encoder(enc);
    out
}

fn data_url(bytes: &[u8]) -> String {
    format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Where the preview of a frame is kept while the card is open.
pub fn view_path(cache: &Path, frame: &Path) -> PathBuf {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(frame.to_string_lossy().as_bytes());
    if let Ok(m) = fs::metadata(frame) {
        h.update(m.len().to_le_bytes());
    }
    let d = h.finalize();
    cache.join(format!("{:x}.jpg", u128::from_be_bytes(d[..16].try_into().unwrap())))
}

fn open_frame(path: &Path) -> Option<(DynamicImage, Meta)> {
    let bytes = fs::read(path).ok()?;
    let meta = meta(path, &bytes[..bytes.len().min(256 * 1024)]);
    let mut img = if JPEG.contains(&ext_of(path).as_str()) {
        let mut dec = image::codecs::jpeg::JpegDecoder::new(Cursor::new(&bytes)).ok()?;
        let o = dec.orientation().ok();
        let mut img = DynamicImage::from_decoder(dec).ok()?;
        if let Some(o) = o {
            img.apply_orientation(o);
        }
        return Some((img, meta));
    } else {
        embedded_jpeg(&bytes)?
    };
    // the camera's preview is stored as the sensor sees it; the RAW's EXIF says how to turn it
    if let Some(o) = image::metadata::Orientation::from_exif(meta.orientation as u8) {
        img.apply_orientation(o);
    }
    Some((img, meta))
}

fn measure(path: &Path, cache: &Path) -> Option<Frame> {
    let (img, meta) = open_frame(path)?;
    let view = img.resize(VIEW, VIEW, FilterType::Triangle);
    let _ = fs::write(view_path(cache, path), jpeg_data(&view, 82));
    let small = view.resize(MEASURE, MEASURE, FilterType::Triangle);
    let gray = small.to_luma8();
    let thumb = view.resize(THUMB, THUMB, FilterType::Triangle);
    let stamp = meta.stamp.or_else(|| {
        fs::metadata(path).ok()?.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs_f64())
    })?;
    Some(Frame {
        name: path.file_name()?.to_string_lossy().to_string(),
        path: path.to_path_buf(),
        src: data_url(&jpeg_data(&thumb, 70)),
        t: stamp.rem_euclid(86400.0),
        burst: None,
        sharp: (sharpness(&gray) * 1000.0).round() / 1000.0,
        clip: (clipping(&gray) * 1000.0).round() / 1000.0,
        hash: dhash(&small),
        stamp,
    })
}

/// Frames taken less than 1.5 s apart that look alike form a burst.
pub fn group_bursts(frames: &mut [Frame]) {
    frames.sort_by(|a, b| a.stamp.partial_cmp(&b.stamp).unwrap().then_with(|| a.name.cmp(&b.name)));
    let mut id = 0;
    for i in 1..frames.len() {
        let close = frames[i].stamp - frames[i - 1].stamp <= 1.5;
        let alike = (frames[i].hash ^ frames[i - 1].hash).count_ones() <= 14;
        if close && alike {
            let b = frames[i - 1].burst.unwrap_or_else(|| {
                id += 1;
                id
            });
            frames[i - 1].burst = Some(b);
            frames[i].burst = Some(b);
        }
    }
}

/// Measures the whole card on every core. `progress(done, total)` is called as frames finish.
pub fn scan(folder: &Path, cache: &Path, progress: impl Fn(usize, usize) + Sync) -> Vec<Frame> {
    let files = list(folder);
    let _ = fs::remove_dir_all(cache);
    let _ = fs::create_dir_all(cache);
    let total = files.len();
    let (next, done) = (AtomicUsize::new(0), AtomicUsize::new(0));
    let out = Mutex::new(Vec::with_capacity(total));
    let workers = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(1, 8);
    progress(0, total);
    std::thread::scope(|s| {
        for _ in 0..workers {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some(path) = files.get(i) else { break };
                if let Some(f) = measure(path, cache) {
                    out.lock().unwrap().push(f);
                }
                let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                if n % 4 == 0 || n == total {
                    progress(n, total);
                }
            });
        }
    });
    let mut frames = out.into_inner().unwrap();
    group_bursts(&mut frames);
    frames
}

/// Moves the dropped frames into "Respinse", next to where they were, with their twins: the .xmp sidecar
/// and the JPEG of a RAW+JPEG pair. Nothing is deleted; moving them back undoes it.
pub fn reject(folder: &Path, paths: &[PathBuf]) -> Moved {
    let mut r = Moved::default();
    for p in paths {
        // only frames from the folder that was scanned
        if !p.starts_with(folder) || !p.is_file() {
            r.missing += 1;
            continue;
        }
        let (Some(dir), Some(stem)) = (p.parent(), p.file_stem().and_then(|s| s.to_str())) else { continue };
        let to = dir.join(REJECTED);
        if fs::create_dir_all(&to).is_err() {
            r.missing += 1;
            continue;
        }
        let stem = stem.to_lowercase();
        let twins: Vec<PathBuf> = fs::read_dir(dir)
            .map(|it| {
                it.flatten()
                    .map(|e| e.path())
                    .filter(|q| q.is_file() && q.file_stem().and_then(|s| s.to_str()).map(|s| s.to_lowercase() == stem).unwrap_or(false))
                    .collect()
            })
            .unwrap_or_default();
        let mut ok = false;
        for q in twins {
            let Some(name) = q.file_name() else { continue };
            let mut dest = to.join(name);
            let mut n = 1;
            while dest.exists() {
                n += 1;
                dest = to.join(format!("{} ({n}).{}", q.file_stem().unwrap().to_string_lossy(), ext_of(&q)));
            }
            ok |= fs::rename(&q, &dest).is_ok();
        }
        if ok {
            r.moved += 1
        } else {
            r.missing += 1
        }
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Luma, RgbImage};

    fn pattern(w: u32, h: u32, blur: f32) -> DynamicImage {
        let img = RgbImage::from_fn(w, h, |x, y| {
            let v = if ((x / 6) + (y / 6)) % 2 == 0 { 30 } else { 220 };
            image::Rgb([v, v, v])
        });
        let d = DynamicImage::ImageRgb8(img);
        if blur > 0.0 { d.blur(blur) } else { d }
    }

    #[test]
    fn sharp_frames_score_higher_than_blurred() {
        let sharp = sharpness(&pattern(640, 480, 0.0).to_luma8());
        let soft = sharpness(&pattern(640, 480, 4.0).to_luma8());
        assert!(sharp > 0.9 && soft < 0.35, "sharp {sharp} soft {soft}");
    }

    #[test]
    fn burnt_frames_are_found() {
        let white = GrayImage::from_pixel(100, 100, Luma([255]));
        let mid = GrayImage::from_pixel(100, 100, Luma([128]));
        assert_eq!(clipping(&white), 1.0);
        assert_eq!(clipping(&mid), 0.0);
    }

    #[test]
    fn the_biggest_embedded_jpeg_is_used() {
        let small = jpeg_data(&pattern(200, 150, 0.0), 80);
        let big = jpeg_data(&pattern(800, 600, 0.0), 80);
        let mut raw = b"II*\0 not a real raw ".to_vec();
        raw.extend(&small);
        raw.extend(b"sensor data \xFF\xD8\xFF\xC3 broken");
        raw.extend(&big);
        raw.extend(b"tail");
        let img = embedded_jpeg(&raw).unwrap();
        assert_eq!((img.width(), img.height()), (800, 600));
    }

    #[test]
    fn dates_are_read() {
        assert_eq!(parse_stamp("1970:01:02 00:00:01", "5"), Some(86401.5));
        assert_eq!(find_date(b"xx\x002026:11:08 13:20:01\x00"), parse_stamp("2026:11:08 13:20:01", ""));
        assert_eq!(find_date(b"nothing here"), None);
    }

    #[test]
    fn bursts_need_time_and_likeness() {
        let f = |name: &str, stamp: f64, hash: u64| Frame { name: name.into(), path: name.into(), src: String::new(), t: 0.0, burst: None, sharp: 0.0, clip: 0.0, hash, stamp };
        let mut v = vec![f("a", 10.0, 0), f("b", 10.4, 1), f("c", 10.9, 3), f("d", 11.2, u64::MAX), f("e", 40.0, u64::MAX)];
        group_bursts(&mut v);
        let b: Vec<_> = v.iter().map(|x| x.burst).collect();
        assert_eq!(b, vec![Some(1), Some(1), Some(1), None, None]);
    }

    #[test]
    fn raw_and_jpeg_pairs_show_once_and_move_together() {
        let dir = std::env::temp_dir().join("hsk-cull-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(REJECTED)).unwrap();
        for n in ["IMG_1.CR3", "IMG_1.JPG", "IMG_1.xmp", "IMG_2.jpg", "notes.txt", "Respinse/IMG_0.CR3"] {
            fs::write(dir.join(n), b"x").unwrap();
        }
        let l = list(&dir);
        let names: Vec<_> = l.iter().map(|p| p.file_name().unwrap().to_string_lossy().to_string()).collect();
        assert_eq!(names, vec!["IMG_1.CR3", "IMG_2.jpg"]);
        let r = reject(&dir, &[dir.join("IMG_1.CR3"), PathBuf::from("/etc/passwd")]);
        assert_eq!((r.moved, r.missing), (1, 1));
        for n in ["IMG_1.CR3", "IMG_1.JPG", "IMG_1.xmp"] {
            assert!(dir.join(REJECTED).join(n).exists() && !dir.join(n).exists());
        }
        let _ = fs::remove_dir_all(&dir);
    }
}
