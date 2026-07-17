//! Minimal binary PPM (P6) reader and RGB24 pixel comparison. No `image` crate —
//! this is the only fixture format the spike needs, and hand-parsing it keeps the
//! dependency list to exactly one crate (the thing under test).

use ffmpeg_the_third::util::frame::video::Video;
use std::fs;
use std::io;

pub fn read_ppm(path: &str) -> io::Result<(u32, u32, Vec<u8>)> {
    let bytes = fs::read(path)?;
    if bytes.get(0..2) != Some(b"P6") {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "not a P6 PPM"));
    }

    // Header is whitespace-separated ASCII tokens: "P6 <width> <height> <maxval>\n"
    // followed immediately by raw binary pixel data.
    let mut pos = 2;
    let mut tokens = Vec::new();
    while tokens.len() < 3 {
        while bytes[pos].is_ascii_whitespace() {
            pos += 1;
        }
        let start = pos;
        while !bytes[pos].is_ascii_whitespace() {
            pos += 1;
        }
        tokens.push(std::str::from_utf8(&bytes[start..pos]).unwrap().to_string());
    }
    pos += 1; // single whitespace byte separating maxval from pixel data

    let width: u32 = tokens[0].parse().unwrap();
    let height: u32 = tokens[1].parse().unwrap();
    let pixels = bytes[pos..].to_vec();
    let expected = (width * height * 3) as usize;
    if pixels.len() < expected {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("truncated PPM: expected {expected} bytes, got {}", pixels.len()),
        ));
    }
    Ok((width, height, pixels[..expected].to_vec()))
}

/// Copies plane 0 out of an RGB24 frame respecting stride — `Video::data()` includes
/// row padding, and a naive full-buffer byte compare against a tightly-packed PPM
/// would spuriously fail whenever linesize != width * 3.
pub fn extract_rgb24(frame: &Video) -> Vec<u8> {
    let width = frame.width() as usize;
    let height = frame.height() as usize;
    let stride = frame.stride(0);
    let data = frame.data(0);

    let mut out = Vec::with_capacity(width * height * 3);
    for row in 0..height {
        let start = row * stride;
        out.extend_from_slice(&data[start..start + width * 3]);
    }
    out
}

/// Returns (mean absolute difference, max absolute difference) across all bytes.
pub fn compare(a: &[u8], b: &[u8]) -> (f64, u8) {
    assert_eq!(a.len(), b.len(), "compared buffers must be the same size");
    let mut sum: u64 = 0;
    let mut max: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        let diff = x.abs_diff(*y);
        sum += diff as u64;
        max = max.max(diff);
    }
    (sum as f64 / a.len() as f64, max)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compare_identical_buffers_is_zero() {
        let buf = vec![10u8, 20, 30, 200];
        assert_eq!(compare(&buf, &buf), (0.0, 0));
    }

    #[test]
    fn compare_detects_known_difference() {
        let a = vec![10u8, 20, 30, 40];
        let b = vec![10u8, 25, 30, 20];
        // diffs: 0, 5, 0, 20 -> mean 6.25, max 20
        assert_eq!(compare(&a, &b), (6.25, 20));
    }

    #[test]
    fn read_ppm_matches_known_fixture_dimensions() {
        let (w, h, pixels) =
            read_ppm("../fixtures/reference/frame_at_0.5s.ppm").expect("fixture must be readable");
        assert_eq!((w, h), (320, 240));
        assert_eq!(pixels.len(), (w * h * 3) as usize);
    }
}
