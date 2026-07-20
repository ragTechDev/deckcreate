//! Same minimal PPM (P6) reader/comparator as the ffmpeg candidate. Duplicated rather
//! than shared via a third crate — each candidate stays a fully standalone build so a
//! contributor without GStreamer installed can still build/run the ffmpeg candidate
//! (and vice versa), which is itself part of what criterion #3 (build complexity) asks.

use std::fs;
use std::io;

pub fn read_ppm(path: &str) -> io::Result<(u32, u32, Vec<u8>)> {
    let bytes = fs::read(path)?;
    if bytes.get(0..2) != Some(b"P6") {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "not a P6 PPM"));
    }

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
    pos += 1;

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

/// Copies a tightly-packed RGB24 buffer out of a strided plane (GStreamer pads each
/// row to a 4-byte boundary by default, same reasoning as the ffmpeg candidate).
pub fn extract_rgb24(data: &[u8], width: u32, height: u32, stride: i32) -> Vec<u8> {
    let width = width as usize;
    let height = height as usize;
    let stride = stride as usize;
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
    fn extract_rgb24_strips_row_padding() {
        // 2x2 RGB, stride padded to 8 bytes/row (2 bytes of padding after 6 real bytes)
        let data: Vec<u8> = vec![
            1, 2, 3, 4, 5, 6, 0, 0, // row 0: two pixels + padding
            7, 8, 9, 10, 11, 12, 0, 0, // row 1
        ];
        let out = extract_rgb24(&data, 2, 2, 8);
        assert_eq!(out, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    }
}
