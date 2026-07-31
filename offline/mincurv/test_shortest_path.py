"""end-to-end tests for build_shortest_path_line() against synthetic centerlines.

mirrors test_line.py's structure and CSV helpers exactly.
"""

from __future__ import annotations

import numpy as np
import pytest

from offline.geometry.pipeline import build_track
from offline.mincurv.line import build_mincurv_line
from offline.mincurv.shortest_path import build_shortest_path_line, solve_shortest_path_offsets

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


def test_circle_shortest_path_hugs_inner_boundary(tmp_path) -> None:
    # for constant curvature + constant width, the true shortest path is provably "hug the
    # inner boundary at the max allowed offset" -- a smaller circle has a smaller circumference.
    # this is the one case where the QP's linearized answer should match closed-form geometry.
    radius, width, margin_m = 100.0, 8.0, 1.0
    csv_path = _circle_csv(tmp_path, radius=radius, width=width)
    track = build_track(csv_path, circuit_name="TestCircle", spacing_m=2.0, gps_noise_std_m=0.0)

    line = build_shortest_path_line(track, margin_m=margin_m, spacing_m=2.0, qp_spacing_m=5.0)

    # width is the per-side track width (w_tr_left_m == w_tr_right_m == width in this CSV
    # helper), so the max inward offset is (width - margin_m); positive alpha is the left
    # normal, which points inward for this CCW parametrization.
    expected_length = 2 * np.pi * (radius - width + margin_m)
    assert line.loop_length_m == pytest.approx(expected_length, rel=0.02)
    assert line.loop_length_m < track.loop_length_m


def test_stadium_shortest_path_shorter_than_mincurv(tmp_path) -> None:
    # DESIGN_NOTES.md section 7's sanity check is "min-curvature < centerline through a
    # chicane" specifically -- on a single-direction turn like this stadium's semicircles,
    # min-curvature widens out to raise the corner radius and is routinely *longer* than the
    # centerline (it trades path length for a straighter, faster arc). That's real motorsport
    # behavior, not a bug, so this test only checks the comparison that holds unconditionally:
    # shortest-path is shorter than min-curvature. The full three-way ordering (including a
    # real chicane) is checked on Monza in test_integration_monza_shortest_path.py.
    csv_path = _stadium_csv(tmp_path, radius=20.0, straight_length=100.0, width=8.0)
    track = build_track(csv_path, circuit_name="TestStadium", spacing_m=2.0, gps_noise_std_m=0.0)

    shortest_line = build_shortest_path_line(track, margin_m=1.0, spacing_m=2.0, qp_spacing_m=5.0)
    mincurv_line = build_mincurv_line(track, margin_m=1.0, spacing_m=2.0, qp_spacing_m=5.0)

    assert shortest_line.loop_length_m < mincurv_line.loop_length_m


def test_infeasible_margin_raises(tmp_path) -> None:
    csv_path = _circle_csv(tmp_path, radius=100.0, width=0.5)
    track = build_track(csv_path, circuit_name="TestNarrow", spacing_m=2.0, gps_noise_std_m=0.0)

    with pytest.raises(ValueError, match="narrower than 2\\*margin_m"):
        solve_shortest_path_offsets(track, margin_m=1.0, qp_spacing_m=5.0)
