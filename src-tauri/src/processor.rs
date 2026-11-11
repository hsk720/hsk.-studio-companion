//! Local processing: the "live" version of a photo, made here so the upload is small.

use image::imageops::FilterType;
use image::{DynamicImage, ImageDecoder, ImageReader};
use std::path::Path;

pub const LONG_EDGE: u32 = 2560;
pub const QUALITY: f32 = 82.0;

pub const EXTENSIONS: [&str; 3] = ["jpg", "jpeg", "png"];

pub fn is_photo(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    // Lightroom and Capture One write through temporary files; the Finder leaves ._ files on external disks
    if name.starts_with('.') || name.starts_with('~') {
        return false;
    }
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Decodes, turns the photo upright (the EXIF orientation is not carried into the WebP),
/// fits it in LONG_EDGE and encodes lossy WebP. Runs on a blocking thread.
pub fn to_webp(path: &Path) -> Result<Vec<u8>, String> {
    let unreadable = |_| "Fișierul nu a putut fi citit ca poză.".to_string();
    let mut decoder = ImageReader::open(path)
        .map_err(|_| "Fișierul nu a putut fi deschis.".to_string())?
        .with_guessed_format()
        .map_err(|_| "Fișierul nu a putut fi deschis.".to_string())?
        .into_decoder()
        .map_err(unreadable)?;
    let orientation = decoder.orientation().map_err(unreadable)?;
    let mut img = DynamicImage::from_decoder(decoder).map_err(unreadable)?;
    img.apply_orientation(orientation);
    if img.width().max(img.height()) > LONG_EDGE {
        img = img.resize(LONG_EDGE, LONG_EDGE, FilterType::Lanczos3);
    }
    let rgb = img.into_rgb8();
    let encoded = webp::Encoder::from_rgb(rgb.as_raw(), rgb.width(), rgb.height()).encode(QUALITY);
    Ok(encoded.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn large_jpeg_becomes_a_smaller_webp() {
        let path = std::env::temp_dir().join("hsk-companion-test.jpg");
        let img = image::RgbImage::from_fn(4000, 3000, |x, y| image::Rgb([(x / 16) as u8, (y / 12) as u8, ((x + y) / 28) as u8]));
        img.save(&path).unwrap();
        let webp = to_webp(&path).unwrap();
        assert_eq!(&webp[..4], b"RIFF");
        assert_eq!(&webp[8..12], b"WEBP");
        // VP8 keyframe header: 14 bits of width at byte 26, of height at byte 28
        let w = u16::from_le_bytes([webp[26], webp[27]]) & 0x3fff;
        let h = u16::from_le_bytes([webp[28], webp[29]]) & 0x3fff;
        assert_eq!((w as u32, h as u32), (LONG_EDGE, LONG_EDGE * 3 / 4));
        assert!((webp.len() as u64) < std::fs::metadata(&path).unwrap().len());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn only_photos_are_picked_up() {
        assert!(is_photo(Path::new("/x/IMG_0001.JPG")));
        assert!(is_photo(Path::new("/x/a.png")));
        assert!(!is_photo(Path::new("/x/._IMG_0001.jpg")));
        assert!(!is_photo(Path::new("/x/IMG_0001.jpg.tmp")));
        assert!(!is_photo(Path::new("/x/IMG_0001.CR3")));
    }
}
