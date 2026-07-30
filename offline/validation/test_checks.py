"""tests for the validation harness against synthetic geometry with known analytic properties.

a circle of radius R has constant curvature kappa = 1/R everywhere, so these checks can be
proven correct before any real (noisy, TUMFTM-derived) track data exists.
"""

from __future__ import annotations

import numpy as np
import pytest

from offline.validation.checks import (
    assert_loop_closes,
    assert_no_normal_crossings,
    curvature_deviation,
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
