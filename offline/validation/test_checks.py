"""tests for the validation harness against synthetic geometry with known analytic properties.

a circle of radius R has constant curvature kappa = 1/R everywhere, so these checks can be
proven correct before any real (noisy, TUMFTM-derived) track data exists.
"""

from __future__ import annotations

import numpy as np
import pytest

from offline.validation.checks import (
    assert_closed_loop_velocity,
    assert_energy_balance,
    assert_friction_circle_respected,
    assert_loop_closes,
    assert_no_normal_crossings,
    assert_within_track_bounds,
    curvature_deviation,
    lateral_deviation,
)


def circle_points(radius: float, n: int = 400) -> np.ndarray:
    theta = np.linspace(0, 2 * np.pi, n, endpoint=True)
    return np.column_stack([radius * np.cos(theta), radius * np.sin(theta)])


def test_closed_loop_passes() -> None:
    points = circle_points(radius=50.0)
    assert_loop_closes(points)


def test_open_loop_raises() -> None:
    points = circle_points(radius=50.0)[:-1]
    with pytest.raises(AssertionError, match="loop does not close"):
        assert_loop_closes(points)


def test_narrow_track_no_crossings() -> None:
    n = 400
    kappa = np.full(n, 1.0 / 50.0)
    left_width = np.full(n, 4.0)
    right_width = np.full(n, 4.0)
    assert_no_normal_crossings(kappa, left_width, right_width)


def test_hairpin_wide_track_raises() -> None:
    n = 400
    kappa = np.full(n, 1.0 / 5.0)
    left_width = np.full(n, 8.0)
    right_width = np.full(n, 8.0)
    with pytest.raises(AssertionError, match="normal crossing"):
        assert_no_normal_crossings(kappa, left_width, right_width)


def test_curvature_deviation_identical_is_zero() -> None:
    kappa = np.full(100, 1.0 / 50.0)
    stats = curvature_deviation(kappa, kappa.copy())
    assert stats["max_abs_error"] == pytest.approx(0.0)
    assert stats["rmse"] == pytest.approx(0.0)


def test_curvature_deviation_shape_mismatch_raises() -> None:
    with pytest.raises(ValueError, match="shape mismatch"):
        curvature_deviation(np.zeros(10), np.zeros(11))


def test_closed_loop_velocity_passes() -> None:
    v = np.array([10.0, 20.0, 30.0, 10.0])
    assert_closed_loop_velocity(v)


def test_open_loop_velocity_raises() -> None:
    v = np.array([10.0, 20.0, 30.0, 15.0])
    with pytest.raises(AssertionError, match="does not close"):
        assert_closed_loop_velocity(v)


def test_energy_balance_within_power_limit_passes() -> None:
    # net tire force exactly at the power limit at 50 m/s: ax_tire_net = power/(mass*v)
    mass_kg, power_w, v = 1300.0, 410_000.0, np.array([50.0])
    ax_tire_net = power_w / (mass_kg * v)
    ax_drag = np.array([2.0])
    ax_mps2 = ax_tire_net - ax_drag  # realized accel = tire net minus drag
    assert_energy_balance(v, ax_mps2, ax_drag, mass_kg, power_w)


def test_energy_balance_over_power_limit_raises() -> None:
    mass_kg, power_w, v = 1300.0, 410_000.0, np.array([50.0])
    ax_tire_net = 2.0 * power_w / (mass_kg * v)  # double the available power
    ax_drag = np.array([2.0])
    ax_mps2 = ax_tire_net - ax_drag
    with pytest.raises(AssertionError, match="power budget violated"):
        assert_energy_balance(v, ax_mps2, ax_drag, mass_kg, power_w)


def test_within_bounds_passes() -> None:
    offset = np.array([-2.0, 0.0, 2.0])
    w_left = np.full(3, 3.0)
    w_right = np.full(3, 3.0)
    assert_within_track_bounds(offset, w_left, w_right)


def test_beyond_left_boundary_raises() -> None:
    offset = np.array([-2.0, 0.0, 3.5])
    w_left = np.full(3, 3.0)
    w_right = np.full(3, 3.0)
    with pytest.raises(AssertionError, match="leaves the track"):
        assert_within_track_bounds(offset, w_left, w_right)


def test_beyond_right_boundary_raises() -> None:
    offset = np.array([-3.5, 0.0, 2.0])
    w_left = np.full(3, 3.0)
    w_right = np.full(3, 3.0)
    with pytest.raises(AssertionError, match="leaves the track"):
        assert_within_track_bounds(offset, w_left, w_right)


def test_within_bounds_margin_shrinks_the_valid_range() -> None:
    # offset=2.5 fits inside width=3.0 with no margin, but not once margin_m=1.0 eats into it
    offset = np.array([2.5])
    w_left = np.array([3.0])
    w_right = np.array([3.0])
    assert_within_track_bounds(offset, w_left, w_right, margin_m=0.0)
    with pytest.raises(AssertionError, match="leaves the track"):
        assert_within_track_bounds(offset, w_left, w_right, margin_m=1.0)


def test_friction_circle_within_limit_passes() -> None:
    ay_max = np.array([15.0, 15.0])
    ax_tire = np.array([9.0, -9.0])
    ay = np.array([12.0, 12.0])  # hypot(9, 12) = 15, exactly on the circle
    assert_friction_circle_respected(ax_tire, ay, ay_max)


def test_friction_circle_exceeded_raises() -> None:
    ay_max = np.array([15.0])
    ax_tire = np.array([20.0])
    ay = np.array([20.0])  # hypot(20, 20) ~= 28.3, way past the 15 limit
    with pytest.raises(AssertionError, match="friction circle violated"):
        assert_friction_circle_respected(ax_tire, ay, ay_max)


def test_lateral_deviation_identical_lines_is_zero() -> None:
    line = np.column_stack([np.linspace(0, 10, 50), np.zeros(50)])
    stats = lateral_deviation(line, line.copy())
    assert stats["max_m"] == pytest.approx(0.0, abs=1e-9)
    assert stats["mean_m"] == pytest.approx(0.0, abs=1e-9)


def test_lateral_deviation_parallel_offset_lines_matches_offset() -> None:
    s = np.linspace(0, 10, 200)
    line_a = np.column_stack([s, np.zeros(200)])
    line_b = np.column_stack([s, np.full(200, 1.5)])
    stats = lateral_deviation(line_a, line_b)
    assert stats["max_m"] == pytest.approx(1.5, abs=1e-2)
    assert stats["mean_m"] == pytest.approx(1.5, abs=1e-2)
