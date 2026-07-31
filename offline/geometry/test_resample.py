"""resample_by_arc_length: uniform spacing and exact closure."""

from __future__ import annotations

import numpy as np
from scipy.interpolate import splev

from offline.geometry.resample import resample_by_arc_length
from offline.geometry.spline import fit_closed_centerline_spline


def test_resampled_points_are_uniformly_spaced_and_closed() -> None:
    theta = np.linspace(0, 2 * np.pi, 60, endpoint=False)
    x, y = 50 * np.cos(theta), 50 * np.sin(theta)
    spline = fit_closed_centerline_spline(x, y, smoothing_factor=0.0)

    spacing_m = 2.0
    u, s = resample_by_arc_length(spline, spacing_m)
    points = np.column_stack(splev(u, spline.tck, der=0))

    assert len(s) == round(s[-1] / spacing_m) + 1
    # actual spacing is total_length / n_segments, close to but not bit-exact with the
    # requested spacing_m since n_segments is rounded to the nearest integer
    assert np.allclose(np.diff(s), spacing_m, atol=0.01)

    step_lengths = np.hypot(*np.diff(points, axis=0).T)
    assert np.allclose(step_lengths, spacing_m, atol=0.05)

    assert np.array_equal(points[0], points[-1])
