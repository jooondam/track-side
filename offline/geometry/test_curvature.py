"""curvature_from_derivatives against hand-computed textbook derivatives, independent of scipy."""

from __future__ import annotations

import numpy as np
import pytest

from offline.geometry.curvature import curvature_from_derivatives


def test_unit_circle_ccw_curvature_is_one() -> None:
    theta = np.linspace(0, 2 * np.pi, 400, endpoint=False)
    dx, dy = -np.sin(theta), np.cos(theta)
    ddx, ddy = -np.cos(theta), -np.sin(theta)
    kappa = curvature_from_derivatives(dx, dy, ddx, ddy)
    assert kappa == pytest.approx(1.0, abs=1e-9)


def test_circle_radius_r_curvature_is_one_over_r() -> None:
    r = 37.5
    theta = np.linspace(0, 2 * np.pi, 400, endpoint=False)
    dx, dy = -r * np.sin(theta), r * np.cos(theta)
    ddx, ddy = -r * np.cos(theta), -r * np.sin(theta)
    kappa = curvature_from_derivatives(dx, dy, ddx, ddy)
    assert kappa == pytest.approx(1.0 / r, abs=1e-9)


def test_straight_line_curvature_is_zero() -> None:
    n = 50
    dx = np.full(n, 2.0)
    dy = np.full(n, 0.0)
    ddx = np.zeros(n)
    ddy = np.zeros(n)
    kappa = curvature_from_derivatives(dx, dy, ddx, ddy)
    assert kappa == pytest.approx(0.0, abs=1e-12)


def test_cw_circle_curvature_is_negative() -> None:
    theta = np.linspace(0, 2 * np.pi, 400, endpoint=False)
    dx, dy = np.sin(theta), np.cos(theta)
    ddx, ddy = np.cos(theta), -np.sin(theta)
    kappa = curvature_from_derivatives(dx, dy, ddx, ddy)
    assert kappa == pytest.approx(-1.0, abs=1e-9)
