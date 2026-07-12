use rustfft::{num_complex::Complex, FftPlanner};

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
}
