"""tests for the M4 minimum-time NLP against synthetic geometries with known behavior.

casadi is an optional dependency ([project.optional-dependencies] "reference" in
pyproject.toml). importorskip keeps `pytest -q` green for anyone who hasn't installed it.
"""

from __future__ import annotations

import numpy as np
import pytest

casadi = pytest.importorskip("casadi")

from offline.geometry.pipeline import build_track
from offline.mincurv.line import build_mincurv_line
from offline.reference.mintime import _ax_drag_expr, _ax_engine_expr, _ay_max_expr, solve_mintime
from offline.velocity.solver import solve_velocity_profile
from offline.velocity.vehicle import DEFAULT_GT3, GT3Vehicle

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


def test_casadi_physics_matches_vehicle_module() -> None:
    # the NLP hand-writes elementwise CasADi mirrors of GT3Vehicle's scalar formulas (see
    # mintime.py's module docstring for why). This guards the two from silently drifting apart.
    vehicle = DEFAULT_GT3
    v_samples = np.array([5.0, 20.0, 50.0, 80.0])

    v_sym = casadi.MX.sym("v", len(v_samples))
    fn = casadi.Function(
        "physics",
        [v_sym],
        [_ay_max_expr(v_sym, vehicle), _ax_drag_expr(v_sym, vehicle), _ax_engine_expr(v_sym, vehicle)],
    )
    ay_max_casadi, ax_drag_casadi, ax_engine_casadi = fn(v_samples)

    np.testing.assert_allclose(
        np.asarray(ay_max_casadi).flatten(), [vehicle.ay_max_mps2(v) for v in v_samples], rtol=1e-10
    )
    np.testing.assert_allclose(
        np.asarray(ax_drag_casadi).flatten(), [vehicle.ax_drag_mps2(v) for v in v_samples], rtol=1e-10
    )
    np.testing.assert_allclose(
        np.asarray(ax_engine_casadi).flatten(), [vehicle.ax_engine_mps2(v) for v in v_samples], rtol=1e-10
    )


def test_circle_converges_and_stays_within_bounds(tmp_path) -> None:
    csv_path = _circle_csv(tmp_path, radius=100.0, width=8.0)
    track = build_track(csv_path, circuit_name="TestCircle", spacing_m=2.0, gps_noise_std_m=0.0)

    solution = solve_mintime(track, DEFAULT_GT3, margin_m=1.0, qp_spacing_m=5.0)

    # solve_mintime's internal hard gates (assert_within_track_bounds,
    # assert_closed_loop_velocity, assert_friction_circle_respected) already ran without
    # raising: reaching this point is itself a pass of those checks.
    assert solution.lap_time_s > 0.0
    assert np.all(np.isfinite(solution.v_mps))


def test_higher_mu_gives_lap_time_no_worse(tmp_path) -> None:
    csv_path = _stadium_csv(tmp_path, radius=20.0, straight_length=150.0, width=8.0)
    track = build_track(csv_path, circuit_name="TestStadium", spacing_m=2.0, gps_noise_std_m=0.0)

    low_grip = solve_mintime(track, GT3Vehicle(mu=0.8), margin_m=1.0, qp_spacing_m=5.0)
    high_grip = solve_mintime(track, GT3Vehicle(mu=1.4), margin_m=1.0, qp_spacing_m=5.0)

    assert high_grip.lap_time_s <= low_grip.lap_time_s + 1e-6


def test_two_stage_converges_and_stays_within_lap_time_tolerance(tmp_path) -> None:
    # this stadium track (150m straight, 20m corner radius) is an artificially extreme case,
    # not representative of a real circuit. Unlike real Monza (see
    # test_integration_monza_mintime.py), it needs a much larger tolerance than the 0.01
    # default to visibly smooth the straight (see mintime.py's module docstring). Here just
    # check the mechanism itself: converges cleanly and the lap-time constraint actually holds,
    # not that wiggle is dramatically reduced at the default tolerance on this specific track.
    csv_path = _stadium_csv(tmp_path, radius=20.0, straight_length=150.0, width=8.0)
    track = build_track(csv_path, circuit_name="TestStadium", spacing_m=2.0, gps_noise_std_m=0.0)

    baseline = solve_mintime(track, DEFAULT_GT3, margin_m=1.0, qp_spacing_m=5.0, two_stage=False)
    smoothed = solve_mintime(
        track, DEFAULT_GT3, margin_m=1.0, qp_spacing_m=5.0, two_stage=True, lap_time_tolerance=0.01
    )

    assert smoothed.lap_time_s <= baseline.lap_time_s * 1.01 + 1e-6
    assert smoothed.lap_time_s >= baseline.lap_time_s - 1e-6  # can't be faster than the T1 baseline


def test_mintime_beats_or_matches_mincurv_plus_m2_baseline(tmp_path) -> None:
    csv_path = _stadium_csv(tmp_path, radius=20.0, straight_length=150.0, width=8.0)
    track = build_track(csv_path, circuit_name="TestStadium", spacing_m=2.0, gps_noise_std_m=0.0)

    baseline_line = build_mincurv_line(track, margin_m=1.0, spacing_m=2.0, qp_spacing_m=5.0)
    baseline_profile = solve_velocity_profile(baseline_line, DEFAULT_GT3)

    solution = solve_mintime(track, DEFAULT_GT3, margin_m=1.0, qp_spacing_m=5.0)

    # mintime jointly optimizes path + speed together, a superset of the sequential
    # QP-then-velocity-solve search space, so it should never do worse (small tolerance for
    # the coarse-vs-fine grid and linearization slack between the two methods).
    assert solution.lap_time_s <= baseline_profile.lap_time_s + 0.5


def test_infeasible_margin_raises(tmp_path) -> None:
    csv_path = _circle_csv(tmp_path, radius=100.0, width=0.5)
    track = build_track(csv_path, circuit_name="TestNarrow", spacing_m=2.0, gps_noise_std_m=0.0)

    with pytest.raises(ValueError, match="narrower than 2\\*margin_m"):
        solve_mintime(track, DEFAULT_GT3, margin_m=1.0, qp_spacing_m=5.0)
