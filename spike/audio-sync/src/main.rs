use audio_sync::{compute_cross_correlation, find_best_lag, load_wav_samples, validate_peak};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("Usage: audio-sync <ref.wav> <target.wav>");
        std::process::exit(1);
    }

    let run = || -> Result<(), Box<dyn std::error::Error>> {
        let (samples_a, sample_rate) = load_wav_samples(&args[1])?;
        let (samples_b, _) = load_wav_samples(&args[2])?;

        let correlation = compute_cross_correlation(&samples_a, &samples_b);
        let lag = find_best_lag(&correlation, sample_rate);
        let (snr, is_reliable) = validate_peak(&correlation, lag, sample_rate);

        let confidence = if is_reliable { "" } else { "  [LOW CONFIDENCE]" };
        println!("lag: {lag:.6}s  snr: {snr:.3}{confidence}");
        Ok(())
    };

    if let Err(e) = run() {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}
