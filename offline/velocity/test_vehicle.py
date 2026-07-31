"""GT3Vehicle: closed-form checks against hand-calculated values."""

from __future__ import annotations

import pytest

from offline.velocity.vehicle import DEFAULT_GT3, GT3Vehicle


def test_ay_max_at_zero_speed_is_mu_g() -> None:
    v = GT3Vehicle(mu=1.2, g_mps2=9.81)
    assert v.ay_max_mps2(0.0) == pytest.approx(1.2 * 9.81)


def test_ay_max_increases_with_speed() -> None:
    v = DEFAULT_GT3
    assert v.ay_max_mps2(50.0) > v.ay_max_mps2(20.0) > v.ay_max_mps2(0.0)


def test_ax_drag_is_zero_at_zero_speed_and_grows_with_v_squared() -> None:
    v = DEFAULT_GT3
    assert v.ax_drag_mps2(0.0) == 0.0
    assert v.ax_drag_mps2(20.0) == pytest.approx(4 * v.ax_drag_mps2(10.0), rel=1e-9)


def test_ax_engine_decreases_with_speed() -> None:
    v = DEFAULT_GT3
    assert v.ax_engine_mps2(10.0) > v.ax_engine_mps2(50.0) > v.ax_engine_mps2(80.0)


def test_v_top_is_where_engine_and_drag_accel_balance() -> None:
    v = DEFAULT_GT3
    v_top = v.v_top_mps
    assert v.ax_engine_mps2(v_top) == pytest.approx(v.ax_drag_mps2(v_top), rel=1e-6)
    # a realistic GT3 Monza top speed, not an implausible point-mass artifact
    assert 70.0 < v_top < 95.0
