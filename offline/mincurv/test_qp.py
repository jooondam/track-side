"""tests for the minimum-curvature QP against synthetic geometries with known behavior.

_FakeTrack is a minimal stand-in exposing only the fields build_min_curv_qp/
solve_lateral_offsets actually read (s_m, kappa_1pm, w_tr_left_m, w_tr_right_m, plus the
loop_length_m/n_points properties) -- qp.py never touches x_m/y_m/heading_rad, so building a
full TrackGeometry (which requires a genuinely closed, non-self-intersecting curve) would be
unnecessary ceremony for these tests. Same duck-typing spirit already used by
offline/velocity/solver.py against RacelineGeometry.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pytest
from scipy import sparse

from offline.geometry.curvature import curvature_from_derivatives
from offline.mincurv.qp import _circulant_second_difference, build_min_curv_qp, solve_lateral_offsets


@dataclass(frozen=True)
class _FakeTrack:
    circuit_name: str
    source_path: Path
    s_m: np.ndarray
    kappa_1pm: np.ndarray
    w_tr_left_m: np.ndarray
    w_tr_right_m: np.ndarray

    @property
    def loop_length_m(self) -> float:
        return float(self.s_m[-1])

    @property
    def n_points(self) -> int:
        return len(self.s_m)


def _circle_track(radius: float, width_m: float, n: int = 300) -> _FakeTrack:
    s = np.linspace(0.0, 2 * np.pi * radius, n, endpoint=True)
    kappa_ref = np.full(n, 1.0 / radius)
    w = np.full(n, width_m)
    return _FakeTrack("circle", Path("synthetic"), s, kappa_ref, w, w)


def test_circle_unconstrained_saturates_uniformly_at_outer_bound() -> None:
    # a bare circle has no straight to trade curvature against, so minimising sum(kappa^2)
    # pushes every point to the largest-radius (outer) bound -- alpha=0 is NOT optimal here.
    # N_left points toward the circle's centre (matches curvature.py's CCW convention), so the
    # outward direction is negative alpha; expected value is -(w_tr_right_m - margin_m).
    margin = 1.0
    width = 5.0
    track = _circle_track(radius=100.0, width_m=width)
    alpha = solve_lateral_offsets(track, margin_m=margin, qp_spacing_m=5.0)

    expected = -(width - margin)
    assert alpha[:-1] == pytest.approx(expected, abs=1e-3)
    assert alpha[-1] == pytest.approx(alpha[0])


def test_s_curve_offset_flips_sign_across_curvature_reversal() -> None:
    # kappa_ref = k0*cos(theta) is positive on one half of the loop and negative on the other
    # -- two opposite-sign "corners" joined smoothly, like an S. Minimising curvature should
    # cut from one corner's outside to the other's, i.e. alpha strongly anti-correlated with
    # kappa_ref. Bounds are kept wide (500 m) so the box never binds -- this checks the QP's
    # natural unconstrained shape, not a clipped one.
    n = 300
    loop_radius_for_s = 300.0
    s = np.linspace(0.0, 2 * np.pi * loop_radius_for_s, n, endpoint=True)
    theta = s / loop_radius_for_s
    kappa_ref = 0.05 * np.cos(theta)
    w = np.full(n, 500.0)
    track = _FakeTrack("s-curve", Path("synthetic"), s, kappa_ref, w, w)

    alpha = solve_lateral_offsets(track, margin_m=1.0, qp_spacing_m=5.0)

    corr = np.corrcoef(alpha[:-1], kappa_ref[:-1])[0, 1]
    assert corr < -0.5

    i_pos_peak = int(np.argmax(kappa_ref))
    i_neg_peak = int(np.argmin(kappa_ref))
    assert alpha[i_pos_peak] < 0.0
    assert alpha[i_neg_peak] > 0.0


def test_infeasible_margin_raises() -> None:
    track = _circle_track(radius=100.0, width_m=0.5)
    with pytest.raises(ValueError, match="narrower than 2\\*margin_m"):
        build_min_curv_qp(track, margin_m=1.0, qp_spacing_m=5.0)


def test_linearization_error_shrinks_quadratically_with_offset() -> None:
    # verify the small-offset linearization itself: perturb a small alpha, compare the QP's
    # affine prediction kappa_ref_fd + A@alpha against curvature recomputed exactly from the
    # perturbed points. Using an FD-self-consistent kappa_ref_fd (not the production
    # spline-analytic kappa_1pm) makes the alpha=0 error exactly zero, isolating the O(alpha^2)
    # linearization error from the unrelated FD-vs-spline discretization gap.
    n = 400
    radius = 80.0
    theta = np.arange(n) * (2 * np.pi / n)
    h = 2 * np.pi * radius / n
    x, y = radius * np.cos(theta), radius * np.sin(theta)
    heading = theta + np.pi / 2
    normal_x, normal_y = -np.sin(heading), np.cos(heading)

    def central_diff(v: np.ndarray) -> np.ndarray:
        return (np.roll(v, -1) - np.roll(v, 1)) / (2 * h)

    def central_diff2(v: np.ndarray) -> np.ndarray:
        return (np.roll(v, -1) - 2 * v + np.roll(v, 1)) / h**2

    kappa_ref_fd = curvature_from_derivatives(
        central_diff(x), central_diff(y), central_diff2(x), central_diff2(y)
    )
    a_fd = (_circulant_second_difference(n, h) + sparse.diags(kappa_ref_fd**2)).tocsr()

    shape = np.sin(2 * np.pi * np.arange(n) / n)
    epsilons = np.array([1.0, 0.5, 0.25, 0.125, 0.0625])
    errors = []
    for eps in epsilons:
        alpha = eps * shape
        kappa_pred = kappa_ref_fd + a_fd @ alpha
        x_perturbed, y_perturbed = x + alpha * normal_x, y + alpha * normal_y
        kappa_exact = curvature_from_derivatives(
            central_diff(x_perturbed),
            central_diff(y_perturbed),
            central_diff2(x_perturbed),
            central_diff2(y_perturbed),
        )
        errors.append(np.max(np.abs(kappa_exact - kappa_pred)))

    slope, _ = np.polyfit(np.log(epsilons), np.log(errors), 1)
    assert 1.5 < slope < 2.5
