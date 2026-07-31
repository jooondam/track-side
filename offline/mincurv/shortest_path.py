"""shortest-path QP: a baseline path-length comparison, not a grip proxy.

reimplemented from the same source TUM's own opt_shortest_path.py cites (Braghin, Cheli, Melzi,
Sabbioni, "Race Driver Model", DOI: 10.1016/j.compstruc.2007.04.028), confirmed against TUM's
actual published implementation (trajectory_planning_helpers/opt_shortest_path.py) to use the
identical formulation -- no regularizer, no smoothing term, matching this module exactly.

exact path length is a nonlinear arc-length integral, not a QP -- same reasoning already used
for offline/mincurv/qp.py's minimum-curvature linearization applies here. Instead, minimize
sum(||segment_i||^2), the squared length of each segment between consecutive offset points, a
standard convex proxy for total path length.

Point i on the offset path is P_i(alpha) = P_ref_i + alpha_i * N_i (identical parametrization to
build_min_curv_qp). The segment from point i to i+1 (periodic, i+1 mod M) is:

    seg_i = (P_ref_{i+1} - P_ref_i) + alpha_{i+1}*N_{i+1} - alpha_i*N_i

affine in alpha. Splitting into x/y components gives Sx @ alpha + dx_ref and Sy @ alpha + dy_ref,
where Sx/Sy are sparse (M, M) *variable-coefficient* bidiagonal-with-periodic-wrap operators
(built the same way qp.py's _circulant_second_difference builds its periodic wrap -- lil format,
patch the corner entry, convert to csr -- just with array-valued coefficients from the normal
directions instead of a constant +/-1/-2). Stacking A = vstack([Sx, Sy]) and
rhs = -concatenate([dx_ref, dy_ref]) turns this into the same bounded linear least squares
problem qp.py already solves with lsq_linear, same box bounds, same solver call.

NOT a grip-response proxy. An earlier version of this project's plan blended this line with the
minimum-curvature line as an approximation of how the racing line should change with grip --
that turned out to be unfounded on two counts, checked directly against real Monza data before
being adopted: (1) TUM's own documentation never associates shortest-path with grip or friction
conditions -- it's listed as one of several interchangeable objective choices, with friction
response handled only by their minimum-time optimizer (this project's own offline/reference/
mintime.py plays that role here); (2) minimizing path length hugs every apex tightly, which
*raises* local curvature and therefore *costs* cornering speed -- measured on Monza, this line is
slower than the plain, unoptimized centerline at every regularization strength tried, and no
amount of smoothing closed that gap. docs/DESIGN_NOTES.md section 0.1 was revised to Option D
(grip-invariant path, velocity-only response) once this was found. This module is kept as a
standalone baseline path-length comparison -- exactly how TUM itself uses it -- not as
production output: see the length-ordering sanity checks in test_shortest_path.py and
test_integration_monza_shortest_path.py (shortest-path < min-curvature < centerline through a
chicane, docs/DESIGN_NOTES.md section 7).

Known, accepted (not a bug): on a long straight, the normal direction is ~constant, so Sx/Sy
become singular in the constant-offset direction -- any parallel straight line has the same
length, so the true shortest path is genuinely indifferent there. lsq_linear picks *some*
feasible point in that null space. Harmless for a length-comparison baseline; would matter if
this were ever driven, which per the above it isn't.
"""

from __future__ import annotations

import numpy as np
from scipy import sparse
from scipy.interpolate import CubicSpline
from scipy.optimize import lsq_linear

from offline.geometry.pipeline import TrackGeometry
from offline.mincurv.line import OptimizedLine, build_line_from_offsets


def _weighted_forward_difference(coeff: np.ndarray) -> sparse.csr_matrix:
    """sparse (M, M): (mat @ v)[i] = coeff[(i+1)%M]*v[(i+1)%M] - coeff[i]*v[i], periodic wrap."""
    m = len(coeff)
    mat = sparse.diags([-coeff, coeff[1:]], offsets=[0, 1], shape=(m, m), format="lil")
    mat[m - 1, 0] = coeff[0]
    return mat.tocsr()


def build_shortest_path_qp(
    track: TrackGeometry, margin_m: float = 1.0, qp_spacing_m: float = 5.0
) -> tuple[sparse.csr_matrix, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """build the linearized shortest-path least-squares system on a coarse arc-length grid.

    returns (a, rhs, lb, ub, coarse_s), ready for lsq_linear(a, rhs, bounds=(lb, ub)) -- same
    shape of return value as build_min_curv_qp, same box bounds (track width minus margin_m on
    each side), same ValueError on a track narrower than 2*margin_m.
    """
    m = max(1, round(track.loop_length_m / qp_spacing_m))
    coarse_s = np.linspace(0.0, track.loop_length_m, m, endpoint=False)

    x_ref = np.interp(coarse_s, track.s_m, track.x_m)
    y_ref = np.interp(coarse_s, track.s_m, track.y_m)
    normal_x_full = -np.sin(track.heading_rad)
    normal_y_full = np.cos(track.heading_rad)
    normal_x = np.interp(coarse_s, track.s_m, normal_x_full)
    normal_y = np.interp(coarse_s, track.s_m, normal_y_full)
    w_left = np.interp(coarse_s, track.s_m, track.w_tr_left_m)
    w_right = np.interp(coarse_s, track.s_m, track.w_tr_right_m)

    dx_ref = np.roll(x_ref, -1) - x_ref
    dy_ref = np.roll(y_ref, -1) - y_ref

    s_x = _weighted_forward_difference(normal_x)
    s_y = _weighted_forward_difference(normal_y)

    a = sparse.vstack([s_x, s_y]).tocsr()
    rhs = -np.concatenate([dx_ref, dy_ref])

    lb = -(w_right - margin_m)
    ub = w_left - margin_m
    if np.any(lb > ub):
        worst = int(np.argmax(lb - ub))
        raise ValueError(
            f"track narrower than 2*margin_m={2 * margin_m:.2f} m at index {worst} "
            f"(w_tr_left={w_left[worst]:.2f} m, w_tr_right={w_right[worst]:.2f} m); "
            "cannot fit the safety margin"
        )

    return a, rhs, lb, ub, coarse_s


def solve_shortest_path_offsets(
    track: TrackGeometry, margin_m: float = 1.0, qp_spacing_m: float = 5.0
) -> np.ndarray:
    """solve the bound-constrained shortest-path least-squares problem, return alpha(s).

    convex (sum of squares of an affine map) with only box constraints, so any solution
    lsq_linear finds is the global optimum. Solved on the coarse qp_spacing_m grid, then
    upsampled back onto track's full-resolution arc-length grid with a periodic cubic spline --
    identical upsampling approach to solve_lateral_offsets, for the same reason (keeps alpha''
    continuous rather than piecewise-linear). Returned array has length track.n_points, with
    alpha[-1] == alpha[0].
    """
    a, rhs, lb, ub, coarse_s = build_shortest_path_qp(track, margin_m, qp_spacing_m)
    result = lsq_linear(a, rhs, bounds=(lb, ub), method="trf")
    alpha_coarse = result.x

    wrap_s = np.append(coarse_s, track.loop_length_m)
    wrap_alpha = np.append(alpha_coarse, alpha_coarse[0])
    upsample = CubicSpline(wrap_s, wrap_alpha, bc_type="periodic")
    return upsample(track.s_m)


def build_shortest_path_line(
    track: TrackGeometry,
    margin_m: float = 1.0,
    spacing_m: float = 1.0,
    loop_closure_tol_m: float = 1e-3,
    qp_spacing_m: float = 5.0,
) -> OptimizedLine:
    """solve the shortest-path QP on track and return a validated racing line, or raise."""
    alpha = solve_shortest_path_offsets(track, margin_m, qp_spacing_m)
    return build_line_from_offsets(
        track,
        alpha,
        method="shortest-path QP over Frenet-frame lateral offsets",
        margin_m=margin_m,
        spacing_m=spacing_m,
        loop_closure_tol_m=loop_closure_tol_m,
    )
