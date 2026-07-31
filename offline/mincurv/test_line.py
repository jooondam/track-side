"""end-to-end tests for build_mincurv_line() against synthetic centerlines.

builds real TrackGeometry via build_track() (not a stand-in), since build_mincurv_line -- unlike
qp.py -- needs x_m/y_m/heading_rad to reconstruct offset points and refit a spline.
"""

from __future__ import annotations

import numpy as np

from offline.geometry.pipeline import build_track
from offline.mincurv.line import build_mincurv_line

HEADER = "# x_m,y_m,w_tr_right_m,w_tr_left_m\n"


def _circle_csv(tmp_path, radius: float, width: float, n: int = 300):
    theta = np.linspace(0.0, 2 * np.pi, n, endpoint=False)
    x, y = radius * np.cos(theta), radius * np.sin(theta)
    w = np.full(n, width)
    lines = [f"{xi:.6f},{yi:.6f},{wi:.3f},{wi:.3f}" for xi, yi, wi in zip(x, y, w)]
    path = tmp_path / "circle.csv"
    path.write_text(HEADER + "\n".join(lines) + "\n")
    return path


def _stadium_csv(tmp_path, radius: float, straight_length: float, width: float):
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
    path = tmp_path / "stadium.csv"
    path.write_text(HEADER + "\n".join(lines) + "\n")
    return path


def test_circle_line_closes_stays_in_bounds_and_reduces_curvature(tmp_path) -> None:
    csv_path = _circle_csv(tmp_path, radius=100.0, width=5.0)
    track = build_track(csv_path, circuit_name="TestCircle", spacing_m=2.0, gps_noise_std_m=0.0)

    line = build_mincurv_line(track, margin_m=1.0, spacing_m=2.0, qp_spacing_m=5.0)

    # build_mincurv_line's internal hard gates (assert_loop_closes, assert_within_track_bounds)
    # already ran without raising -- reaching this point is itself a pass of those checks.
    assert np.max(np.abs(line.kappa_1pm)) < np.max(np.abs(track.kappa_1pm))


def test_stadium_line_closes_stays_in_bounds_and_reduces_peak_curvature(tmp_path) -> None:
    csv_path = _stadium_csv(tmp_path, radius=20.0, straight_length=100.0, width=6.0)
    track = build_track(csv_path, circuit_name="TestStadium", spacing_m=2.0, gps_noise_std_m=0.0)

    line = build_mincurv_line(track, margin_m=1.0, spacing_m=2.0, qp_spacing_m=5.0)

    assert np.max(np.abs(line.kappa_1pm)) < np.max(np.abs(track.kappa_1pm))
