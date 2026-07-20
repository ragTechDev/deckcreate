//! Spike harness for issue #108: does `ffmpeg-the-third` decode-and-seek a real
//! .mp4 frame-accurately, and can it reach VideoToolbox without extra shims?
//!
//! Usage: ffmpeg-candidate <clip.mp4> <timestamp_secs> <reference.ppm> [--hw]

use std::env;
use std::process::ExitCode;

use ffmpeg_the_third as ffmpeg;
use ffmpeg_the_third::software::scaling::{context::Context as Scaler, flag::Flags};
use ffmpeg_the_third::util::format::pixel::Pixel;

mod ppm;

const AV_TIME_BASE: f64 = 1_000_000.0;

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    if args.len() < 4 {
        eprintln!(
            "usage: {} <clip.mp4> <timestamp_secs> <reference.ppm> [--hw]",
            args.first().map(String::as_str).unwrap_or("ffmpeg-candidate")
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
) -> Result<bool, ffmpeg::Error> {
    ffmpeg::init()?;

    let mut input = ffmpeg::format::input(clip_path)?;
    let stream = input
        .streams()
        .best(ffmpeg::media::Type::Video)
        .ok_or(ffmpeg::Error::StreamNotFound)?;
    let stream_index = stream.index();
    let time_base = stream.time_base();

    let mut decoder_ctx = ffmpeg::codec::context::Context::from_parameters(stream.parameters())?;

    if use_hw {
        // No high-level API for this in ffmpeg-the-third — see FINDINGS.md criterion #1.
        // SAFETY: decoder_ctx.as_mut_ptr() is a valid, exclusively-owned AVCodecContext
        // that has not yet been opened (avcodec_open2 happens inside `.video()` below),
        // so setting hw_device_ctx/get_format here is exactly the window FFmpeg's own
        // hw_decode.c example requires them to be set in.
        unsafe {
            hw::attach_hardware(decoder_ctx.as_mut_ptr())?;
        }
    }

    let mut decoder = decoder_ctx.decoder().video()?;

    // Seek near the target, then decode forward to the exact frame — this is the
    // real-world jump-cut access pattern, not just sequential decode from frame 0.
    input.seek((timestamp_secs * AV_TIME_BASE) as i64, ..)?;
    decoder.flush();

    let mut rgb_frame = ffmpeg::util::frame::video::Video::empty();
    let mut scaler: Option<Scaler> = None;
    let mut hw_path_active = false;
    let mut found: Option<ffmpeg::util::frame::video::Video> = None;

    'decode: for item in input.packets() {
        let (packet_stream, packet) = item?;
        if packet_stream.index() != stream_index {
            continue;
        }
        decoder.send_packet(&packet)?;

        let mut decoded = ffmpeg::util::frame::video::Video::empty();
        while decoder.receive_frame(&mut decoded).is_ok() {
            let pts_secs = decoded
                .pts()
                .map(|pts| pts as f64 * f64::from(time_base))
                .unwrap_or(f64::NEG_INFINITY);

            if pts_secs + 1e-6 < timestamp_secs {
                continue; // not there yet, keep decoding forward from the seek point
            }

            let software_frame = if use_hw {
                let (transferred, was_hw) = hw::transfer_to_software(&decoded)?;
                hw_path_active = hw_path_active || was_hw;
                transferred
            } else {
                decoded.clone()
            };

            if scaler.is_none() {
                scaler = Some(Scaler::get(
                    software_frame.format(),
                    software_frame.width(),
                    software_frame.height(),
                    Pixel::RGB24,
                    software_frame.width(),
                    software_frame.height(),
                    Flags::BILINEAR,
                )?);
            }
            scaler.as_mut().unwrap().run(&software_frame, &mut rgb_frame)?;
            found = Some(rgb_frame.clone());
            break 'decode;
        }
    }

    let Some(frame) = found else {
        eprintln!("never reached timestamp {timestamp_secs}s before end of stream");
        return Ok(false);
    };

    if use_hw {
        println!(
            "HARDWARE PATH: {}",
            if hw_path_active { "active" } else { "inactive (fell back to software)" }
        );
    }

    let (ref_w, ref_h, ref_pixels) =
        ppm::read_ppm(reference_path).map_err(|_| ffmpeg::Error::InvalidData)?;
    if ref_w != frame.width() || ref_h != frame.height() {
        eprintln!(
            "dimension mismatch: decoded {}x{} vs reference {}x{}",
            frame.width(),
            frame.height(),
            ref_w,
            ref_h
        );
        return Ok(false);
    }

    let decoded_pixels = ppm::extract_rgb24(&frame);
    let (mean_diff, max_diff) = ppm::compare(&decoded_pixels, &ref_pixels);
    // Tolerance covers rounding differences in chroma upsampling / colorspace matrices
    // between decode paths (e.g. libswscale vs VideoToolbox's own YUV->RGB), not a
    // license to silently accept a wrong frame.
    let pass = mean_diff < 2.0 && max_diff < 24;
    println!(
        "seek target {timestamp_secs}s -> mean_abs_diff={mean_diff:.3} max_abs_diff={max_diff} -> {}",
        if pass { "PASS" } else { "FAIL" }
    );
    Ok(pass)
}

#[cfg(target_os = "macos")]
mod hw {
    use ffmpeg_the_third as ffmpeg;
    use ffmpeg_the_third::ffi;
    use std::ptr;

    /// Sets up VideoToolbox hw_device_ctx + get_format on an *unopened* decoder context.
    /// This is hand-written unsafe FFI because ffmpeg-the-third has no high-level
    /// hwaccel wrapper (checked: no hwaccel/hwdevice/hwcontext module in the crate).
    pub unsafe fn attach_hardware(
        ctx: *mut ffi::AVCodecContext,
    ) -> Result<(), ffmpeg::Error> {
        let mut hw_device_ctx: *mut ffi::AVBufferRef = ptr::null_mut();
        let ret = ffi::av_hwdevice_ctx_create(
            &mut hw_device_ctx,
            ffi::AVHWDeviceType::VIDEOTOOLBOX,
            ptr::null(),
            ptr::null_mut(),
            0,
        );
        if ret < 0 {
            return Err(ffmpeg::Error::from(ret));
        }
        (*ctx).hw_device_ctx = hw_device_ctx; // ownership transferred to the codec context
        (*ctx).get_format = Some(get_format);
        Ok(())
    }

    unsafe extern "C" fn get_format(
        _ctx: *mut ffi::AVCodecContext,
        mut fmt: *const ffi::AVPixelFormat,
    ) -> ffi::AVPixelFormat {
        while *fmt != ffi::AVPixelFormat::NONE {
            if *fmt == ffi::AVPixelFormat::VIDEOTOOLBOX {
                return *fmt;
            }
            fmt = fmt.add(1);
        }
        ffi::AVPixelFormat::NONE
    }

    /// Copies a decoded frame out of GPU/VideoToolbox memory into a normal software
    /// frame. Returns (frame, was_actually_hardware) — `was_actually_hardware` is false
    /// if the decoder silently used a software pixel format despite the hw request.
    pub fn transfer_to_software(
        decoded: &ffmpeg::util::frame::video::Video,
    ) -> Result<(ffmpeg::util::frame::video::Video, bool), ffmpeg::Error> {
        if decoded.format() != ffmpeg::util::format::pixel::Pixel::VIDEOTOOLBOX {
            // Decoder chose a software format from get_format's candidate list —
            // hardware path did not engage for this frame.
            return Ok((decoded.clone(), false));
        }
        let mut software_frame = ffmpeg::util::frame::video::Video::empty();
        unsafe {
            let ret = ffi::av_hwframe_transfer_data(
                software_frame.as_mut_ptr(),
                decoded.as_ptr(),
                0,
            );
            if ret < 0 {
                return Err(ffmpeg::Error::from(ret));
            }
        }
        Ok((software_frame, true))
    }
}

#[cfg(target_os = "windows")]
mod hw {
    use ffmpeg_the_third as ffmpeg;
    use ffmpeg_the_third::ffi;
    use std::ptr;

    /// Sets up CUDA hw_device_ctx + get_format on an *unopened* decoder context.
    pub unsafe fn attach_hardware(
        ctx: *mut ffi::AVCodecContext,
    ) -> Result<(), ffmpeg::Error> {
        let mut hw_device_ctx: *mut ffi::AVBufferRef = ptr::null_mut();
        let ret = ffi::av_hwdevice_ctx_create(
            &mut hw_device_ctx,
            ffi::AVHWDeviceType::CUDA,
            ptr::null(),
            ptr::null_mut(),
            0,
        );
        if ret < 0 {
            return Err(ffmpeg::Error::from(ret));
        }
        (*ctx).hw_device_ctx = hw_device_ctx;
        (*ctx).get_format = Some(get_format);
        Ok(())
    }

    unsafe extern "C" fn get_format(
        _ctx: *mut ffi::AVCodecContext,
        mut fmt: *const ffi::AVPixelFormat,
    ) -> ffi::AVPixelFormat {
        while *fmt != ffi::AVPixelFormat::NONE {
            if *fmt == ffi::AVPixelFormat::CUDA {
                return *fmt;
            }
            fmt = fmt.add(1);
        }
        ffi::AVPixelFormat::NONE
    }

    pub fn transfer_to_software(
        decoded: &ffmpeg::util::frame::video::Video,
    ) -> Result<(ffmpeg::util::frame::video::Video, bool), ffmpeg::Error> {
        if decoded.format() != ffmpeg::util::format::pixel::Pixel::CUDA {
            return Ok((decoded.clone(), false));
        }
        let mut software_frame = ffmpeg::util::frame::video::Video::empty();
        unsafe {
            let ret = ffi::av_hwframe_transfer_data(
                software_frame.as_mut_ptr(),
                decoded.as_ptr(),
                0,
            );
            if ret < 0 {
                return Err(ffmpeg::Error::from(ret));
            }
        }
        Ok((software_frame, true))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod hw {
    use ffmpeg_the_third as ffmpeg;
    use ffmpeg_the_third::ffi;

    pub unsafe fn attach_hardware(
        _ctx: *mut ffi::AVCodecContext,
    ) -> Result<(), ffmpeg::Error> {
        Err(ffmpeg::Error::Bug)
    }

    pub fn transfer_to_software(
        decoded: &ffmpeg::util::frame::video::Video,
    ) -> Result<(ffmpeg::util::frame::video::Video, bool), ffmpeg::Error> {
        Ok((decoded.clone(), false))
    }
}
