"""fit_closed_centerline_spline / resample_by_arc_length against synthetic geometry with
known analytic curvature.
"""

from __future__ import annotations

import numpy as np
import pytest
from scipy.interpolate import splev

from offline.geometry.curvature import curvature_from_derivatives
from offline.geometry.resample import resample_by_arc_length
from offline.geometry.spline import fit_closed_centerline_spline


def circle_raw_points(radius: float, n: int = 60) -> tuple[np.ndarray, np.ndarray]:
    theta = np.linspace(0, 2 * np.pi, n, endpoint=False)
    return radius * np.cos(theta), radius * np.sin(theta)


def _fit_and_resample(x, y, smoothing_factor: float, spacing_m: float):
    spline = fit_closed_centerline_spline(x, y, smoothing_factor)
    u, s = resample_by_arc_length(spline, spacing_m)
    d1 = np.column_stack(splev(u, spline.tck, der=1))
    d2 = np.column_stack(splev(u, spline.tck, der=2))
    kappa = curvature_from_derivatives(d1[:, 0], d1[:, 1], d2[:, 0], d2[:, 1])
    return spline, u, s, kappa


def test_circle_curvature_matches_one_over_radius() -> None:
    radius = 50.0
    x, y = circle_raw_points(radius, n=80)
    _, _, _, kappa = _fit_and_resample(x, y, smoothing_factor=0.0, spacing_m=2.0)
    assert kappa == pytest.approx(1.0 / radius, rel=0.02)


def test_hairpin_straight_then_tight_arc() -> None:
    # two straights joined by a tight semicircular arc of radius r
    r = 8.0
    straight = np.linspace(0, 40, 30)
    x1 = straight
    y1 = np.zeros_like(straight)
    theta = np.linspace(-np.pi / 2, np.pi / 2, 30)
    x2 = 40 + r * np.sin(theta)
    y2 = r - r * np.cos(theta)
    x3 = 40 - straight
    y3 = np.full_like(straight, 2 * r)
    x = np.concatenate([x1, x2, x3])[:-1]
    y = np.concatenate([y1, y2, y3])[:-1]

    _, _, s, kappa = _fit_and_resample(x, y, smoothing_factor=0.5, spacing_m=1.0)

    on_straight = (s > 5) & (s < 30)
    assert np.max(np.abs(kappa[on_straight])) < 0.05

    on_arc = (s > 50) & (s < 60)
    assert np.max(np.abs(kappa[on_arc])) > 1.0 / (2 * r)


def test_smoothing_reduces_curvature_error_on_noisy_circle() -> None:
    radius = 50.0
    x, y = circle_raw_points(radius, n=120)
    rng = np.random.default_rng(0)
    x_noisy = x + rng.normal(0, 0.15, size=x.shape)
    y_noisy = y + rng.normal(0, 0.15, size=y.shape)

    n = len(x_noisy)
    _, _, _, kappa_unsmoothed = _fit_and_resample(
        x_noisy, y_noisy, smoothing_factor=0.0, spacing_m=2.0
    )
    _, _, _, kappa_smoothed = _fit_and_resample(
        x_noisy, y_noisy, smoothing_factor=n * 0.15**2, spacing_m=2.0
    )

    truth = 1.0 / radius
    rmse_unsmoothed = np.sqrt(np.mean((kappa_unsmoothed - truth) ** 2))
    rmse_smoothed = np.sqrt(np.mean((kappa_smoothed - truth) ** 2))
    assert rmse_smoothed < rmse_unsmoothed
