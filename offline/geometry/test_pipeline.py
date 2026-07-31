"""build_track() actually enforces its hard gates rather than silently continuing."""

from __future__ import annotations

import numpy as np
import pytest

from offline.geometry.pipeline import build_track

HEADER = "# x_m,y_m,w_tr_right_m,w_tr_left_m\n"


def _stadium_csv(tmp_path, radius: float, straight_length: float, width: float, tag: str):
    n_straight, n_cap = 60, 40
    half_l = straight_length / 2

    x1 = np.linspace(-half_l, half_l, n_straight, endpoint=False)
    y1 = np.full(n_straight, -radius)

    a2 = np.linspace(-np.pi / 2, np.pi / 2, n_cap, endpoint=False)
    x2 = half_l + radius * np.cos(a2)
    y2 = radius * np.sin(a2)

    x3 = np.linspace(half_l, -half_l, n_straight, endpoint=False)
    y3 = np.full(n_straight, radius)

    a4 = np.linspace(np.pi / 2, 3 * np.pi / 2, n_cap, endpoint=False)
    x4 = -half_l + radius * np.cos(a4)
    y4 = radius * np.sin(a4)

    x = np.concatenate([x1, x2, x3, x4])
    y = np.concatenate([y1, y2, y3, y4])
    w = np.full(len(x), width)

    lines = [f"{xi:.6f},{yi:.6f},{wi:.3f},{wi:.3f}" for xi, yi, wi in zip(x, y, w)]
    path = tmp_path / f"stadium_{tag}.csv"
    path.write_text(HEADER + "\n".join(lines) + "\n")
    return path


def test_wide_track_on_tight_radius_raises_crossing(tmp_path) -> None:
    # radius=3m cap with width=8m each side: width * kappa = 8 * (1/3) > 1, must trip the gate
    csv_path = _stadium_csv(tmp_path, radius=3.0, straight_length=60.0, width=8.0, tag="tight")
    with pytest.raises(AssertionError, match="normal crossing"):
        build_track(csv_path, circuit_name="TestStadium", spacing_m=1.0, gps_noise_std_m=0.0)


def test_narrow_track_on_same_radius_does_not_raise(tmp_path) -> None:
    # same radius, modest width: width * kappa well under 1, should build cleanly
    csv_path = _stadium_csv(tmp_path, radius=3.0, straight_length=60.0, width=1.0, tag="narrow")
    track = build_track(csv_path, circuit_name="TestStadium", spacing_m=1.0, gps_noise_std_m=0.0)
    assert track.n_points > 0
