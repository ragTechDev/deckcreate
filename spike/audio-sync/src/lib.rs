use rustfft::{num_complex::Complex, FftPlanner};

// Mirror of AudioSyncer.js constants — must not be changed; baseline.json was computed with these.
const PEAK_NEARNESS_THRESHOLD: f64 = 0.5;
const SYNC_FRAME_RATE: f64 = 30.0;

pub fn next_power_of_two(n: usize) -> usize {
    let mut p = 1usize;
    while p < n {
        p <<= 1;
    }
    p
}

/// Cross-correlates two sample buffers via FFT, returning a normalized correlation array.
///
/// Replicates `computeCrossCorrelation` from `scripts/sync/AudioSyncer.js` L145–186.
/// The division by N matches the JS formula: `correlation[i] = result[2*i] / N`.
/// rustfft's inverse transform does not normalize, so the division is applied explicitly here.
///
/// # Preconditions
/// Both slices must be non-empty. An empty slice causes `len_a + len_b - 1` to underflow.
pub fn compute_cross_correlation(samples_a: &[f32], samples_b: &[f32]) -> Vec<f64> {
    let len_a = samples_a.len();
    let len_b = samples_b.len();
    let n = next_power_of_two(len_a + len_b - 1);

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(n);
    let ifft = planner.plan_fft_inverse(n);

    let mut ca: Vec<Complex<f32>> = vec![Complex::default(); n];
    let mut cb: Vec<Complex<f32>> = vec![Complex::default(); n];
    for (i, &s) in samples_a.iter().enumerate() {
        ca[i].re = s;
    }
    for (i, &s) in samples_b.iter().enumerate() {
        cb[i].re = s;
    }

    fft.process(&mut ca);
    fft.process(&mut cb);

    let mut product: Vec<Complex<f32>> = ca.iter().zip(cb.iter()).map(|(a, b)| a * b.conj()).collect();

    ifft.process(&mut product);

    product.iter().map(|c| c.re as f64 / n as f64).collect()
}

/// Finds the best lag from a cross-correlation array, replicating `findBestLag` in
/// `scripts/sync/AudioSyncer.js` L188–216.
///
/// Collects all indices whose absolute value is within `PEAK_NEARNESS_THRESHOLD` of the global
/// maximum, uses the earliest as a deterministic tie-break, converts the circular index to a
/// signed sample lag, then quantizes to the nearest frame boundary at `SYNC_FRAME_RATE` fps.
///
/// Returns the lag in seconds. Returns `0.0` for an all-zero correlation without panicking.
pub fn find_best_lag(correlation: &[f64], sample_rate: u32) -> f64 {
    let n = correlation.len();
    let mut max_val = f64::NEG_INFINITY;
    let mut candidates: Vec<usize> = Vec::new();

    for (i, &v) in correlation.iter().enumerate() {
        let abs_v = v.abs();
        if abs_v > max_val {
            max_val = abs_v;
            candidates.clear();
            candidates.push(i);
        } else if (abs_v - max_val).abs() <= PEAK_NEARNESS_THRESHOLD {
            candidates.push(i);
        }
    }

    // Earliest candidate = deterministic tie-break, matching JS `candidateIndices[0]`.
    let max_idx = candidates.first().copied().unwrap_or(0);

    // Circular index → signed lag in samples.
    let lag_samples = if max_idx <= n / 2 {
        max_idx as f64
    } else {
        max_idx as f64 - n as f64
    };

    // Quantize to nearest frame boundary, return as seconds.
    // Use (x + 0.5).floor() to replicate JavaScript Math.round, which rounds half-frames
    // towards +infinity. Rust's f64::round() rounds away from zero, so Math.round(-1.5) = -1
    // but (-1.5f64).round() = -2 — they diverge on negative half-frame boundaries.
    let x = lag_samples * SYNC_FRAME_RATE / sample_rate as f64;
    let lag_frames = (x + 0.5).floor();
    lag_frames / SYNC_FRAME_RATE
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn next_power_of_two_known_values() {
        assert_eq!(next_power_of_two(1), 1);
        assert_eq!(next_power_of_two(2), 2);
        assert_eq!(next_power_of_two(3), 4);
        assert_eq!(next_power_of_two(300_000), 524288);
    }

    #[test]
    fn cross_correlation_impulse_peak_at_k() {
        // Impulse at index 0 in A, impulse at index K in B.
        // IFFT(FA * conj(FB)) places the peak at N-K (the circular "negative lag" form:
        // peak ≡ -K mod N). The AC accepts "index K or N-K for negative lag".
        let k = 10usize;
        let len = 64usize;
        let mut a = vec![0.0f32; len];
        let mut b = vec![0.0f32; len];
        a[0] = 1.0;
        b[k] = 1.0;

        let corr = compute_cross_correlation(&a, &b);
        let n = corr.len();

        // next_power_of_two(64 + 64 - 1) = 128
        assert_eq!(n, 128, "output length should be next_power_of_two(len_a + len_b - 1)");

        let peak_idx = corr
            .iter()
            .enumerate()
            .max_by(|(_, x), (_, y)| x.partial_cmp(y).unwrap())
            .map(|(i, _)| i)
            .unwrap();

        assert_eq!(peak_idx, n - k, "peak should be at lag N-{k} (circular negative lag)");
    }

    #[test]
    fn cross_correlation_identical_inputs_peak_at_zero() {
        let a: Vec<f32> = (0..32).map(|i| (i as f32).sin()).collect();
        let b = a.clone();
        let corr = compute_cross_correlation(&a, &b);

        let peak_idx = corr
            .iter()
            .enumerate()
            .max_by(|(_, x), (_, y)| x.partial_cmp(y).unwrap())
            .map(|(i, _)| i)
            .unwrap();

        assert_eq!(peak_idx, 0, "identical inputs should have peak at lag 0");
    }

    #[test]
    fn cross_correlation_all_zeros_no_panic() {
        let a = vec![0.0f32; 16];
        let b = vec![0.0f32; 16];
        let corr = compute_cross_correlation(&a, &b);
        assert!(corr.iter().all(|&v| v == 0.0), "all-zero inputs should yield all-zero output");
    }

    #[test]
    fn cross_correlation_single_sample_length_one() {
        let a = vec![1.0f32];
        let b = vec![1.0f32];
        let corr = compute_cross_correlation(&a, &b);
        // next_power_of_two(1 + 1 - 1) = next_power_of_two(1) = 1
        assert_eq!(corr.len(), 1, "single-sample inputs should return length-1 result");
    }

    // --- find_best_lag tests ---

    fn make_corr(len: usize, peak_idx: usize, peak_val: f64) -> Vec<f64> {
        let mut c = vec![0.0f64; len];
        c[peak_idx] = peak_val;
        c
    }

    #[test]
    fn find_best_lag_positive_lag() {
        // Peak at index 100 in length-1024; K <= N/2 so positive lag.
        // 100 * 30 / 8000 = 0.375 → 0 frames → 0.0 s (rounds to zero but formula is correct).
        let corr = make_corr(1024, 100, 1.0);
        let lag = find_best_lag(&corr, 8000);
        let expected = (100.0_f64 * 30.0 / 8000.0 + 0.5).floor() / 30.0;
        assert_eq!(lag, expected);
    }

    #[test]
    fn find_best_lag_positive_lag_nonzero() {
        // Peak at index 267 (≤ N/2 = 512, so positive lag).
        // 267 * 30 / 8000 = 1.00125 → (1.00125 + 0.5).floor() = 1 frame → 1/30 s.
        // Verifies a nonzero positive result so the "positive lag" AC has meaningful coverage.
        let corr = make_corr(1024, 267, 1.0);
        let lag = find_best_lag(&corr, 8000);
        assert_eq!(lag, 1.0 / 30.0);
    }

    #[test]
    fn find_best_lag_negative_lag() {
        // Peak at index 724 in length-1024; K > N/2 → lag = 724 - 1024 = -300 samples.
        // -300 * 30 / 8000 = -1.125 → round to -1 frame → -1/30 s (survives quantization).
        let corr = make_corr(1024, 724, 1.0);
        let lag = find_best_lag(&corr, 8000);
        assert!(lag < 0.0, "peak at index > N/2 should yield a negative lag, got {lag}");
        let expected = ((-300.0_f64) * 30.0 / 8000.0).round() / 30.0;
        assert_eq!(lag, expected);
    }

    #[test]
    fn find_best_lag_tie_break_earliest_wins() {
        // Two equal peaks at indices 50 and 200; earliest should win.
        let mut corr = vec![0.0f64; 1024];
        corr[50] = 1.0;
        corr[200] = 1.0;
        let lag = find_best_lag(&corr, 8000);
        let expected = (50.0_f64 * 30.0 / 8000.0).round() / 30.0;
        assert_eq!(lag, expected, "tie-break should select earliest candidate (index 50)");
    }

    #[test]
    fn find_best_lag_all_zeros_no_panic() {
        let corr = vec![0.0f64; 1024];
        let lag = find_best_lag(&corr, 8000);
        assert_eq!(lag, 0.0, "all-zero correlation should return 0.0");
    }

    #[test]
    fn find_best_lag_peak_at_n_over_2_is_positive() {
        // Peak exactly at N/2 = 512; boundary condition: maxIdx <= N/2 → positive lag.
        let corr = make_corr(1024, 512, 1.0);
        let lag = find_best_lag(&corr, 8000);
        assert!(lag >= 0.0, "peak at exactly N/2 should be treated as positive lag, got {lag}");
    }

    #[test]
    fn find_best_lag_negative_half_frame_regression() {
        // lag_samples = -400 → -400 * 30 / 8000 = -1.5 frames.
        // JS Math.round(-1.5) = -1; Rust f64::round(-1.5) = -2.
        // The (x + 0.5).floor() fix must return -1/30, not -2/30.
        let n = 1024usize;
        let corr = make_corr(n, n - 400, 1.0);
        let lag = find_best_lag(&corr, 8000);
        assert_eq!(lag, -1.0 / 30.0, "negative half-frame should round toward +inf like JS Math.round");
    }

    #[test]
    fn find_best_lag_one_frame_at_44100() {
        // 1 frame at 30fps = 44100/30 = 1470 samples; result must be exactly 1/30 s.
        let corr = make_corr(131072, 1470, 1.0);
        let lag = find_best_lag(&corr, 44100);
        let expected = 1.0_f64 / 30.0;
        assert_eq!(lag, expected, "1470 samples at 44100 Hz should give exactly 1/30 s");
    }
}
