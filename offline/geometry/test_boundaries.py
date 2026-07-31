"""boundary offset sign convention: the one test that can catch a left/right swap.

assert_no_normal_crossings is symmetric in both sides by design and can't detect this
class of bug -- these tests check actual physical placement instead.
"""

from __future__ import annotations

import numpy as np
import pytest

from offline.geometry.boundaries import offset_boundary


def _ccw_circle(radius: float, n: int = 400) -> tuple[np.ndarray, np.ndarray]:
    theta = np.linspace(0, 2 * np.pi, n, endpoint=False)
    centerline = np.column_stack([radius * np.cos(theta), radius * np.sin(theta)])
    tangents = np.column_stack([-np.sin(theta), np.cos(theta)])
    return centerline, tangents


def test_ccw_circle_left_boundary_is_inner_right_is_outer() -> None:
    radius = 50.0
    centerline, tangents = _ccw_circle(radius)
    left_width = np.full(len(centerline), 5.0)
    right_width = np.full(len(centerline), 15.0)

    left = offset_boundary(centerline, tangents, left_width, side="left")
    right = offset_boundary(centerline, tangents, right_width, side="right")

    left_radii = np.hypot(*left.T)
    right_radii = np.hypot(*right.T)

    assert left_radii == pytest.approx(radius - 5.0, abs=1e-6)
    assert right_radii == pytest.approx(radius + 15.0, abs=1e-6)


def test_cw_circle_flips_which_side_is_inner() -> None:
    radius = 50.0
    centerline, tangents_ccw = _ccw_circle(radius)
    tangents_cw = -tangents_ccw

    left_width = np.full(len(centerline), 5.0)
    right_width = np.full(len(centerline), 15.0)

    left = offset_boundary(centerline, tangents_cw, left_width, side="left")
    right = offset_boundary(centerline, tangents_cw, right_width, side="right")

    left_radii = np.hypot(*left.T)
    right_radii = np.hypot(*right.T)

    assert left_radii == pytest.approx(radius + 5.0, abs=1e-6)
    assert right_radii == pytest.approx(radius - 15.0, abs=1e-6)
