"""tests for the elevation profile builder against synthetic tracks with known z signals."""

from __future__ import annotations

import numpy as np
import pytest

from offline.elevation.profile import build_elevation_profile
from offline.geometry.pipeline import build_track

HEADER = "# x_m,y_m,w_tr_right_m,w_tr_left_m\n"


def _circle_csv(tmp_path, radius: float = 500.0, width: float = 6.0, n: int = 400):
    theta = np.linspace(0.0, 2 * np.pi, n, endpoint=False)
    x, y = radius * np.cos(theta), radius * np.sin(theta)
    lines = [f"{xi:.6f},{yi:.6f},{width:.3f},{width:.3f}" for xi, yi in zip(x, y)]
    path = tmp_path / "circle.csv"
    path.write_text(HEADER + "\n".join(lines) + "\n")
    return path


def _true_z(s_m: np.ndarray, loop_length_m: float) -> np.ndarray:
    """a smooth periodic elevation signal: one big hill plus a smaller ripple."""
    frac = 2 * np.pi * s_m / loop_length_m
    return 30.0 * np.sin(frac) + 8.0 * np.cos(2 * frac + 0.5)


@pytest.fixture()
def circle_track(tmp_path):
    return build_track(
        _circle_csv(tmp_path), circuit_name="TestCircle", spacing_m=2.0, gps_noise_std_m=0.0
    )


def _samples_on_track(track, rng, n_laps: int = 5, lateral_noise_m: float = 2.0, z_noise_m: float = 0.8):
    """simulate car samples: points near the centerline with noisy z of known true shape."""
    pieces = []
    for _ in range(n_laps):
        s = np.sort(rng.uniform(0.0, track.loop_length_m, 450))
        x = np.interp(s, track.s_m, track.x_m) + rng.normal(0, lateral_noise_m, len(s))
        y = np.interp(s, track.s_m, track.y_m) + rng.normal(0, lateral_noise_m, len(s))
        z = _true_z(s, track.loop_length_m) + rng.normal(0, z_noise_m, len(s))
        pieces.append((x, y, z))
    x = np.concatenate([p[0] for p in pieces])
    y = np.concatenate([p[1] for p in pieces])
    z = np.concatenate([p[2] for p in pieces])
    return x, y, z


def test_profile_recovers_known_shape(circle_track) -> None:
    rng = np.random.default_rng(0)
    x, y, z = _samples_on_track(circle_track, rng)

    profile = build_elevation_profile(circle_track, x, y, z)

    true = _true_z(circle_track.s_m, circle_track.loop_length_m)
    true_rel = true - np.min(true)
    # shape recovery: relative profile within ~1.5 m of truth everywhere despite 0.8 m z-noise
    assert np.max(np.abs(profile.z_m - true_rel)) < 1.5
    assert np.min(profile.z_m) == pytest.approx(0.0, abs=1e-9)


def test_profile_shrugs_off_asymmetric_outliers(circle_track) -> None:
    rng = np.random.default_rng(1)
    x, y, z = _samples_on_track(circle_track, rng)
    # kerb-strike-style spikes: 5% of samples get +8m z, all in the same direction
    n_spike = len(z) // 20
    spike_at = rng.choice(len(z), n_spike, replace=False)
    z = z.copy()
    z[spike_at] += 8.0

    profile = build_elevation_profile(circle_track, x, y, z)

    true = _true_z(circle_track.s_m, circle_track.loop_length_m)
    true_rel = true - np.min(true)
    # medians keep the recovered shape close; a mean-based pipeline would sit ~0.4m high
    assert np.max(np.abs(profile.z_m - true_rel)) < 2.0


def test_profile_rejects_off_track_samples(circle_track) -> None:
    rng = np.random.default_rng(2)
    x, y, z = _samples_on_track(circle_track, rng)
    # a clump of badly misregistered samples 200m off the track with absurd z
    x_bad = np.full(50, float(np.mean(x)) )
    y_bad = np.full(50, float(np.mean(y)))
    z_bad = np.full(50, 500.0)
    profile = build_elevation_profile(
        circle_track, np.append(x, x_bad), np.append(y, y_bad), np.append(z, z_bad)
    )

    assert profile.n_samples_rejected >= 50
    assert profile.total_range_m < 100.0  # the 500m z spike never reached the profile


def test_coverage_gap_raises(circle_track) -> None:
    rng = np.random.default_rng(3)
    x, y, z = _samples_on_track(circle_track, rng)
    # keep only samples from the first 60% of the lap -- a 40% coverage hole
    s_nearest = np.array([
        circle_track.s_m[np.argmin((circle_track.x_m - xi) ** 2 + (circle_track.y_m - yi) ** 2)]
        for xi, yi in zip(x[:200], y[:200])
    ])
    keep = s_nearest < 0.6 * circle_track.loop_length_m
    with pytest.raises(ValueError, match="coverage gap"):
        build_elevation_profile(circle_track, x[:200][keep], y[:200][keep], z[:200][keep])


def test_length_mismatch_raises(circle_track) -> None:
    with pytest.raises(ValueError, match="same length"):
        build_elevation_profile(circle_track, np.zeros(10), np.zeros(10), np.zeros(9))
