//! Spike harness for issue #108: does `gstreamer-rs` decode-and-seek a real .mp4
//! frame-accurately, and can it reach VideoToolbox without extra shims?
//!
//! Usage: gstreamer-candidate <clip.mp4> <timestamp_secs> <reference.ppm> [--hw]
//!
//! Unlike the ffmpeg-the-third candidate, hardware selection here is just naming a
//! different pipeline element (`vtdec_hw` is hardware-only by construction — the
//! pipeline fails to reach PAUSED if VideoToolbox isn't actually available, so a
//! failed preroll below *is* the "inactive" answer for criterion #1, not a bug).
//!
//! Verified on this M3 Mac: `vtdec_hw` negotiates and prerolls (hardware path
//! "active"), but its output pixel-mismatches the reference frame by more than the
//! software path does (see FINDINGS.md criterion #1/#2 — likely a colorimetry/GL
//! readback difference, not a wrong frame; confirmed the target frame itself is
//! correct by diffing against its neighbors). Left as an honest FAIL rather than
//! loosened tolerance or a deeper GL-pipeline fix, since surfacing this friction is
//! the point of the spike, not papering over it.

use std::env;
use std::process::ExitCode;

use gstreamer as gst;
use gstreamer::prelude::*;
use gstreamer_app::AppSink;
use gstreamer_video::VideoInfo;

mod ppm;

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    if args.len() < 4 {
        eprintln!(
            "usage: {} <clip.mp4> <timestamp_secs> <reference.ppm> [--hw]",
            args.first().map(String::as_str).unwrap_or("gstreamer-candidate")
        );
        return ExitCode::FAILURE;
    }
    let clip_path = &args[1];
    let timestamp_secs: f64 = match args[2].parse() {
        Ok(v) => v,
        Err(e) => {
            eprintln!("invalid timestamp '{}': {e}", args[2]);
            return ExitCode::FAILURE;
        }
    };
    let reference_path = &args[3];
    let use_hw = args.iter().any(|a| a == "--hw");

    match run(clip_path, timestamp_secs, reference_path, use_hw) {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run(
    clip_path: &str,
    timestamp_secs: f64,
    reference_path: &str,
    use_hw: bool,
) -> Result<bool, Box<dyn std::error::Error>> {
    gst::init()?;

    // vtdec_hw is macOS/VideoToolbox-only and hardware-only by name. A Windows/NVIDIA
    // contributor completing criterion #1 for that platform should swap this element
    // for `nvh264dec` (NVDEC via the nvcodec plugin) behind a `#[cfg(target_os =
    // "windows")]`-equivalent flag — left as a TODO rather than guessed at here, since
    // it cannot be verified on this machine.
    let decoder_element = if use_hw { "vtdec_hw" } else { "avdec_h264" };
    let pipeline_desc = format!(
        "filesrc location=\"{clip_path}\" ! qtdemux ! h264parse ! {decoder_element} ! \
         videoconvert ! video/x-raw,format=RGB ! appsink name=sink sync=false"
    );

    let pipeline = gst::parse::launch(&pipeline_desc)?
        .downcast::<gst::Pipeline>()
        .expect("parse::launch of a pipeline description returns a Pipeline");
    let appsink = pipeline
        .by_name("sink")
        .expect("named appsink element must exist")
        .downcast::<AppSink>()
        .expect("sink element is an appsink");

    pipeline.set_state(gst::State::Paused)?;
    let (result, _current, _pending) = pipeline.state(Some(gst::ClockTime::from_seconds(10)));
    if let Err(e) = result {
        pipeline.set_state(gst::State::Null)?;
        println!(
            "HARDWARE PATH: {}",
            if use_hw { "inactive (pipeline failed to reach PAUSED)" } else { "n/a (software path)" }
        );
        return Err(format!("pipeline failed to preroll: {e:?}").into());
    }

    let seek_pos = gst::ClockTime::from_nseconds((timestamp_secs * 1_000_000_000.0) as u64);
    pipeline.seek_simple(
        gst::SeekFlags::FLUSH | gst::SeekFlags::ACCURATE,
        seek_pos,
    )?;
    // A flushing seek in PAUSED re-prerolls to the new position; block until it lands.
    pipeline.state(Some(gst::ClockTime::from_seconds(10))).0?;

    if use_hw {
        println!("HARDWARE PATH: active (vtdec_hw negotiated successfully)");
    }

    let sample = appsink.pull_preroll().map_err(|e| format!("pull_preroll: {e:?}"))?;
    let buffer = sample.buffer().ok_or("sample had no buffer")?;
    let caps = sample.caps().ok_or("sample had no caps")?;
    let video_info = VideoInfo::from_caps(caps)?;
    let map = buffer.map_readable()?;

    let decoded_pixels = ppm::extract_rgb24(
        map.as_slice(),
        video_info.width(),
        video_info.height(),
        video_info.stride()[0],
    );

    pipeline.set_state(gst::State::Null)?;

    let (ref_w, ref_h, ref_pixels) = ppm::read_ppm(reference_path)?;
    if ref_w != video_info.width() || ref_h != video_info.height() {
        eprintln!(
            "dimension mismatch: decoded {}x{} vs reference {}x{}",
            video_info.width(),
            video_info.height(),
            ref_w,
            ref_h
        );
        return Ok(false);
    }

    let (mean_diff, max_diff) = ppm::compare(&decoded_pixels, &ref_pixels);
    // Same tolerance rationale as the ffmpeg candidate: covers YUV->RGB rounding
    // differences between decode paths, not a license to accept a wrong frame.
    let pass = mean_diff < 2.0 && max_diff < 24;
    println!(
        "seek target {timestamp_secs}s -> mean_abs_diff={mean_diff:.3} max_abs_diff={max_diff} -> {}",
        if pass { "PASS" } else { "FAIL" }
    );
    Ok(pass)
}
