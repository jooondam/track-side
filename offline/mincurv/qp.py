"""minimum-curvature QP: solve for lateral offsets from the centerline in the Frenet frame.

reimplemented from the published minimum-curvature methodology (Heilmeier et al., "Minimum
Curvature Trajectory Planning and Control for an Autonomous Race Car", Vehicle System Dynamics
58(10), 2020), not ported from TUM's LGPL code -- algorithms aren't copyrightable, their
specific implementation is.

the path is parametrized as P_i(alpha) = P_i,ref + alpha_i * N_i, N_i the left unit normal
(matching offline/geometry/boundaries.py's unit_normals_left convention exactly: positive
alpha moves toward the left boundary). Exact curvature is a rational function of alpha (not a
polynomial), so minimizing sum(kappa^2) directly isn't a QP. Linearizing in the local Frenet
frame and dropping O(alpha^2) terms (valid while |alpha * kappa| << 1, i.e. offset small
relative to local corner radius) gives:

    kappa_i(alpha) ~= kappa_i,ref + kappa_i,ref^2 * alpha_i + alpha''_i

verified against the exact closed-form curvature of a circle of radius R=1/kappa0 offset by a
constant c along its normal: kappa_new = kappa0 / (1 - c*kappa0) ~= kappa0 + c*kappa0^2 --
matching this formula's sign and coefficient exactly (a naive "drop the denominator entirely"
version would instead give a wrong-signed -2*kappa^2*alpha term).

discretizing alpha'' with the standard circulant second difference and writing
A = D2 + diag(kappa_ref^2) makes kappa(alpha) = kappa_ref + A @ alpha exactly affine in alpha,
so minimizing its squared norm is bounded linear least squares -- solved directly with
scipy.optimize.lsq_linear rather than forming the normal equations (which would square the
condition number of A).

The QP is solved on a deliberately coarser arc-length grid than the final output resolution
(qp_spacing_m, default 5 m, vs. the 1 m centerline spacing). D2's entries scale as 1/h^2 while
K2's scale as kappa_ref^2 (order 1e-2 to 1e-4 for a real circuit) -- at 1 m spacing D2 swamps
K2 by four to five orders of magnitude, leaving the system so ill-conditioned that lsq_linear's
default iteration budget doesn't get close to converging (checked empirically: first-order
optimality only reached ~4e-2 after 100 iterations at 1 m spacing, vs ~1e-6 at 5 m). Coarsening
the grid doesn't sacrifice anything the linearization needs -- corner radii are tens of metres,
far larger than a 5 m step -- and the solved offsets are upsampled back onto the full-resolution
grid by linear interpolation before being handed to the spline refit in offline/mincurv/line.py.
"""

from __future__ import annotations

import numpy as np
from scipy import sparse
from scipy.interpolate import CubicSpline
from scipy.optimize import lsq_linear

from offline.geometry.pipeline import TrackGeometry


def _circulant_second_difference(n: int, h: float) -> sparse.csr_matrix:
    """sparse (n, n) circulant discrete Laplacian: D2 @ v approximates v'' with periodic wrap."""
    main = -2.0 * np.ones(n)
    off = 1.0 * np.ones(n)
    d2 = sparse.diags([off, main, off], offsets=[-1, 0, 1], shape=(n, n), format="lil")
    d2[0, n - 1] = 1.0
    d2[n - 1, 0] = 1.0
    return (d2 / h**2).tocsr()


def build_min_curv_qp(
    track: TrackGeometry, margin_m: float = 1.0, qp_spacing_m: float = 5.0
) -> tuple[sparse.csr_matrix, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """build the linearized minimum-curvature least-squares system on a coarse arc-length grid.

    returns (A, kappa_ref, lb, ub, coarse_s): A (M, M) sparse s.t.
    kappa(alpha) ~= kappa_ref + A @ alpha, lb/ub the per-point box bounds on alpha (track width
    minus margin_m on each side), coarse_s the arc-length position (metres) of each of the M
    unknowns -- needed by solve_lateral_offsets to upsample the solved offsets back onto
    track's full-resolution grid. M = round(loop_length_m / qp_spacing_m).

    raises ValueError if the track is narrower than 2*margin_m anywhere -- fail fast, before
    the solver runs on an infeasible box, matching assert_no_normal_crossings' style.
    """
    m = max(1, round(track.loop_length_m / qp_spacing_m))
    h = track.loop_length_m / m
    coarse_s = np.linspace(0.0, track.loop_length_m, m, endpoint=False)

    kappa_ref = np.interp(coarse_s, track.s_m, track.kappa_1pm)
    w_left = np.interp(coarse_s, track.s_m, track.w_tr_left_m)
    w_right = np.interp(coarse_s, track.s_m, track.w_tr_right_m)

    d2 = _circulant_second_difference(m, h)
    k2 = sparse.diags(kappa_ref**2)
    a = (d2 + k2).tocsr()

    lb = -(w_right - margin_m)
    ub = w_left - margin_m
    if np.any(lb > ub):
        worst = int(np.argmax(lb - ub))
        raise ValueError(
            f"track narrower than 2*margin_m={2 * margin_m:.2f} m at index {worst} "
            f"(w_tr_left={w_left[worst]:.2f} m, w_tr_right={w_right[worst]:.2f} m); "
            "cannot fit the safety margin"
        )

    return a, kappa_ref, lb, ub, coarse_s


def solve_lateral_offsets(
    track: TrackGeometry, margin_m: float = 1.0, qp_spacing_m: float = 5.0
) -> np.ndarray:
    """solve the bound-constrained minimum-curvature least-squares problem, return alpha(s).

    convex (sum of squares of an affine map) with only box constraints, so any solution
    lsq_linear finds is the global optimum -- no local-minima risk to worry about. Solved on
    the coarse qp_spacing_m grid (see module docstring for why), then upsampled back onto
    track's full-resolution arc-length grid with a periodic *cubic* spline, not linear
    interpolation -- linear interpolation makes alpha(s) piecewise-linear, i.e. alpha''
    becomes a train of impulses at the coarse nodes, which (via kappa ~= kappa_ref +
    kappa_ref^2*alpha + alpha'') shows up as spurious curvature spikes at every coarse node
    once the offset points are refit with an exact interpolating spline downstream. A cubic
    upsample keeps alpha'' continuous, which is what the linearization actually assumes.
    Returned array has length track.n_points, with alpha[-1] == alpha[0] to match this
    project's closed-duplicate array convention.
    """
    a, kappa_ref, lb, ub, coarse_s = build_min_curv_qp(track, margin_m, qp_spacing_m)
    result = lsq_linear(a, -kappa_ref, bounds=(lb, ub), method="trf")
    alpha_coarse = result.x

    wrap_s = np.append(coarse_s, track.loop_length_m)
    wrap_alpha = np.append(alpha_coarse, alpha_coarse[0])
    upsample = CubicSpline(wrap_s, wrap_alpha, bc_type="periodic")
    return upsample(track.s_m)
