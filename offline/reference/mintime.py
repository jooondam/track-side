"""M4 offline reference: minimum-time NLP over the coarse Frenet grid, solved with IPOPT.

Reimplemented from the published minimum-time methodology (Heilmeier et al. and the wider
Perantoni/Limebeer-style curvilinear formulation), not ported from TUM's LGPL code. Same
licensing posture as offline/mincurv/qp.py.

Jointly optimizes lateral offset n(s) and speed v(s) on the same periodic coarse arc-length
grid offline/mincurv/qp.py's build_min_curv_qp() already builds (default 5 m spacing). This
module calls that function directly and reuses its curvature affine map
kappa(n) = kappa_ref + A @ n and its box bounds on n, rather than re-deriving a second
curvature model. Per docs/DESIGN_NOTES.md assumption #10, the path length element is corrected
for lateral offset via the standard Frenet approximation ds_path = h * (1 - kappa_ref * n),
which (like the curvature linearization it sits alongside) is only accurate while
|n * kappa_ref| << 1.

KNOWN LIMITATION (mitigated by two_stage below, not fully eliminated): n(s) is only weakly
identified wherever the friction circle isn't binding, typically most of a straight, where
kappa_ref~0 makes ds_path effectively independent of n, and if speed there is comfortably under
the cornering limit, small-scale wiggling in n costs the lap-time objective ~nothing (a
genuinely flat direction, not solver noise). Consequence: without two_stage, solve_mintime's
plotted/exported line can show several metres of non-physical lateral wander on straights with
zero effect on lap_time_s.

Three things tried, in order:
1. A smoothness penalty on n's own first differences, blended into the lap-time objective.
   Weights too small to matter left the wiggle unchanged; weights large enough to visibly smooth
   it cost measurable real lap time by fighting legitimate corner-cutting behaviour elsewhere;
   larger still made IPOPT report infeasibility.
2. Anchoring n to the warm start n0 (M3's curvature-optimal line), also blended in. Swept on the
   synthetic stadium track: no smooth tradeoff curve. Low weights barely moved the wiggle metric;
   around weight~0.03 the solver jumped to a qualitatively different local optimum that cut the
   wiggle by ~3x but cost ~9% real lap time, nothing usable in between, and a convergence failure
   right at the transition. Confirmed on Monza too, same discontinuous character.
3. two_stage below: stop blending. Solve for minimum lap time first (T1), then re-solve the same
   physical problem minimizing n's smoothness subject to lap_time <= T1*(1+lap_time_tolerance).
   This is qualitatively different from attempts 1-2: smooth, monotonic tradeoff, no discontinuous
   jumps, always converges. Two things had to be gotten right for it to actually help: (a) the
   smoothness term must penalize n's SECOND difference (curvature-like), not its first
   difference: a first-difference penalty pushes n toward flat/constant, but a legitimate racing line
   crosses a straight diagonally (a smooth ramp, zero second difference, nonzero first
   difference), so a first-difference penalty fights that too and needed ~10% lap time to
   visually flatten a straight; the second-difference version only penalizes actual
   oscillation/curvature. (b) how much tolerance is needed is track-dependent: an artificially
   elongated synthetic stadium track (150m straight, 20m corner radius, an extreme case, not
   representative of a real circuit) needed ~2-3% before the sawtooth visually resolved, but real
   Monza's wiggle drops ~3x at just 0.5-1% tolerance and keeps improving gradually beyond that
   with no discontinuities. Default lap_time_tolerance=0.01 (1%) reflects Monza, the actual target
   circuit, not the synthetic stress test.

two_stage now defaults to True, flipped after the Monza validation above. It roughly doubles
solve time; pass two_stage=False for the original single-solve behavior if that matters more
than the smoother line for a particular use.

Decision variables (length M each, M = number of coarse grid points):
    n        lateral offset from the centerline, metres, same sign convention as the M3 QP's
             alpha (positive = toward the left boundary).
    v        speed, m/s.
    ax_tire  signed net longitudinal tire acceleration, m/s2. Positive = driving force,
             negative = braking. Deliberately NOT decomposed into separate accel/brake
             variables: a single signed quantity bounded by one friction-circle inequality
             and one one-sided engine cap reproduces offline/velocity/solver.py's two-mode
             ax_budget_mps2 exactly (verified by hand): capping ax_tire from above by both the
             circle and ax_engine_mps2(v) gives the forward mode's
             min(ax_tires, ax_engine) - ax_drag once ax_drag is subtracted; letting ax_tire run
             negative down to the circle's floor gives the backward mode's
             -(ax_tires + ax_drag). One smooth NLP instead of two composed sweeps.

Dynamics are posed as M equality constraints on v^2 around the loop:
    v[i+1]^2 - v[i]^2 = 2 * (ax_tire[i] - ax_drag(v[i])) * ds_path[i]
with v[i+1] wrapping to v[0] at the last index. Because that wraparound reuses the same v[0]
decision variable rather than introducing a fresh one, the closed-loop periodic boundary
condition falls out for free: no double-lap trick needed (that was only required in
solver.py because it's a sequential forward/backward sweep, not a simultaneous NLP).

GT3Vehicle's scalar methods (ay_max_mps2, ax_engine_mps2, ax_drag_mps2) can't be called
directly on CasADi MX vectors. ax_engine_mps2 uses Python's builtin max(), which doesn't
vectorize over MX. This module hand-writes elementwise CasADi versions of the same three
formulas (ca.fmax for the speed floor). Because that duplicates physics that must stay in sync
with offline/velocity/vehicle.py, test_mintime.py cross-checks the CasADi expressions against
the canonical Python methods numerically.

Warm start matters a lot here, confirmed empirically while building this: seeding v with the
bare unintegrated cornering-speed cap (v where ay(v)=ay_max(v) at each point's own kappa_ref,
ignoring whether the vehicle could actually have braked down to it by then) leaves the friction
circle violated by 100x+ right at corner entries, and IPOPT spent hundreds of iterations barely
denting that primal infeasibility instead of converging. n0 comes from M3's
solve_lateral_offsets(track, ...) interpolated onto the coarse grid (cheap, already
curvature-optimal). v0/ax_tire0 instead come from running M2's actual solve_velocity_profile on
that coarse path's curvature, via a throwaway duck-typed geometry object. Reusing the real
forward-backward solver as a warm-start generator makes v0 friction-circle-feasible from the
first IPOPT iteration (measured: initial friction-circle violation drops from >100x over the
limit to ~1e-13; initial dynamics-constraint violation drops by ~250x), which is what actually
gets convergence inside a reasonable iteration budget.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

import casadi as ca
import numpy as np

from offline.geometry.pipeline import TrackGeometry
from offline.mincurv.qp import build_min_curv_qp, solve_lateral_offsets
from offline.validation.checks import (
    assert_closed_loop_velocity,
    assert_friction_circle_respected,
    assert_within_track_bounds,
)
from offline.velocity.solver import solve_velocity_profile
from offline.velocity.vehicle import DEFAULT_GT3, GT3Vehicle


@dataclass(frozen=True)
class _CoarseWarmStartGeometry:
    """minimal duck-typed stand-in for RacelineGeometry, exposing only the fields
    solve_velocity_profile actually reads. Reuses M2's real forward-backward solver as a
    warm-start generator (see module docstring) rather than re-deriving its logic here.
    """

    circuit_name: str
    source_path: Path
    s_m: np.ndarray
    x_m: np.ndarray
    y_m: np.ndarray
    kappa_1pm: np.ndarray

_ACCEPTABLE_IPOPT_STATUSES = {"Solve_Succeeded", "Solved_To_Acceptable_Level"}


@dataclass(frozen=True)
class MinTimeSolution:
    circuit_name: str
    source_path: Path
    vehicle: GT3Vehicle
    margin_m: float
    qp_spacing_m: float
    s_m: np.ndarray
    x_m: np.ndarray
    y_m: np.ndarray
    n_m: np.ndarray
    v_mps: np.ndarray
    ax_tire_mps2: np.ndarray
    ay_mps2: np.ndarray
    kappa_1pm: np.ndarray
    lap_time_s: float
    ipopt_status: str
    n_iterations: int
    solve_time_s: float

    @property
    def loop_length_m(self) -> float:
        return float(self.s_m[-1]) if len(self.s_m) else 0.0

    @property
    def n_points(self) -> int:
        return len(self.s_m)

    def to_json_dict(self) -> dict:
        v = self.vehicle
        return {
            "schema_version": 1,
            "meta": {
                "circuit_name": self.circuit_name,
                "source": str(self.source_path),
                "source_license": "TUMFTM/racetrack-database, LGPL-3.0",
                "method": "minimum-time NLP (CasADi/IPOPT) over Frenet-frame n(s), v(s)",
                "margin_m": self.margin_m,
                "qp_spacing_m": self.qp_spacing_m,
                "n_points": self.n_points,
                "lap_time_s": self.lap_time_s,
                "ipopt_status": self.ipopt_status,
                "n_iterations": self.n_iterations,
                "solve_time_s": self.solve_time_s,
                "vehicle": {
                    "mass_kg": v.mass_kg,
                    "mu": v.mu,
                    "downforce_area_m2": v.downforce_area_m2,
                    "drag_area_m2": v.drag_area_m2,
                    "power_w": v.power_w,
                    "air_density_kgpm3": v.air_density_kgpm3,
                    "g_mps2": v.g_mps2,
                },
            },
            "solution": {
                "s_m": self.s_m.tolist(),
                "x_m": self.x_m.tolist(),
                "y_m": self.y_m.tolist(),
                "n_m": self.n_m.tolist(),
                "v_mps": self.v_mps.tolist(),
                "ax_tire_mps2": self.ax_tire_mps2.tolist(),
                "ay_mps2": self.ay_mps2.tolist(),
                "kappa_1pm": self.kappa_1pm.tolist(),
            },
        }


def _ay_max_expr(v, vehicle: GT3Vehicle):
    """CasADi-elementwise mirror of GT3Vehicle.ay_max_mps2. See module docstring."""
    downforce_term = 0.5 * vehicle.air_density_kgpm3 * vehicle.downforce_area_m2 * v**2
    return vehicle.mu * (vehicle.g_mps2 + downforce_term / vehicle.mass_kg)


def _ax_drag_expr(v, vehicle: GT3Vehicle):
    """CasADi-elementwise mirror of GT3Vehicle.ax_drag_mps2."""
    return 0.5 * vehicle.air_density_kgpm3 * vehicle.drag_area_m2 * v**2 / vehicle.mass_kg


def _ax_engine_expr(v, vehicle: GT3Vehicle):
    """CasADi-elementwise mirror of GT3Vehicle.ax_engine_mps2 (ca.fmax replaces Python's max)."""
    return vehicle.power_w / (vehicle.mass_kg * ca.fmax(v, vehicle.v_floor_mps))


def _run_ipopt(
    nlp: dict, opts: dict, z0: np.ndarray, lbx: np.ndarray, ubx: np.ndarray, lbg: np.ndarray, ubg: np.ndarray
) -> tuple[np.ndarray, str, int, float]:
    """solve one NLP with IPOPT, return (z_opt, status, n_iterations, solve_time_s), or raise.

    shared by both stages of the two-stage solve (see solve_mintime) so the solve/stats/
    error-check boilerplate isn't duplicated.
    """
    solver = ca.nlpsol("solver", "ipopt", nlp, opts)
    start = time.perf_counter()
    sol = solver(x0=z0, lbx=lbx, ubx=ubx, lbg=lbg, ubg=ubg)
    solve_time_s = time.perf_counter() - start

    stats = solver.stats()
    status = stats.get("return_status", "unknown")
    if status not in _ACCEPTABLE_IPOPT_STATUSES:
        raise RuntimeError(f"minimum-time NLP failed to converge: IPOPT status {status!r}")

    z_opt = np.asarray(sol["x"]).flatten()
    return z_opt, status, int(stats.get("iter_count", -1)), solve_time_s


def solve_mintime(
    track: TrackGeometry,
    vehicle: GT3Vehicle = DEFAULT_GT3,
    margin_m: float = 1.0,
    qp_spacing_m: float = 5.0,
    max_iter: int = 3000,
    two_stage: bool = True,
    lap_time_tolerance: float = 0.01,
) -> MinTimeSolution:
    """solve the minimum-time NLP on track and return a validated solution, or raise.

    Raises RuntimeError if IPOPT does not converge. A failing solve must never produce
    output that looks successful, matching build_mincurv_line's and build_track's style.
    Hard gates (assert_within_track_bounds, assert_closed_loop_velocity,
    assert_friction_circle_respected) run before the result is returned.

    qp_spacing_m default (5.0) matches build_min_curv_qp's convention and converges reliably
    on small/synthetic tracks (see test_mintime.py). On a real, large track with a wide
    corner-to-straight speed range (Monza's vendored data needs ~1150 points at 5m and spans
    roughly 14-79 m/s), IPOPT's default scaling struggles at that resolution and either times
    out or reports spurious infeasibility at a few metres/sec of true constraint violation
    around 1e-8. offline/test_integration_monza_mintime.py and build_mintime.py's CLI default
    both use qp_spacing_m=15.0 for exactly this reason; pass it explicitly for other real
    tracks too rather than assuming the 5.0 default scales up.

    two_stage (default True) runs a second solve after the first: stage 1 minimizes pure lap
    time as always, then stage 2 re-solves the same physical problem minimizing a smoothness
    measure of n subject to lap_time <= stage1_lap_time * (1 + lap_time_tolerance). This targets
    the straight-line wander in this module's KNOWN LIMITATION section below with lap time as a
    hard constraint rather than a blended objective term, the structural fix for why the two
    earlier (rejected) regularization attempts couldn't cleanly separate "wiggle that doesn't
    matter" from "real lap-time-driven corner behavior." Validated on real Monza (the actual
    target circuit): ~3x less straight-section wiggle at the default lap_time_tolerance=0.01
    (1% lap time cost), converging cleanly every time. Roughly doubles solve time versus
    two_stage=False. Pass two_stage=False for the original single-solve behavior.
    """
    a_sparse, kappa_ref, lb, ub, coarse_s = build_min_curv_qp(track, margin_m, qp_spacing_m)
    m = len(coarse_s)
    h = track.loop_length_m / m
    # ca.DM(scipy_sparse) preserves the sparsity pattern (build_min_curv_qp's A is a circulant
    # tridiagonal-plus-diagonal matrix, ~3 nonzeros per row out of M columns). Densifying it
    # first (ca.DM(a_sparse.toarray())) made CasADi's AD graph and IPOPT's linear algebra treat
    # every one of the M^2 entries as structurally nonzero. Confirmed this was the bottleneck:
    # at Monza's M~1150 the dense version didn't converge inside 10+ minutes of wall time before
    # being killed; the sparse version (below) solves the same problem in seconds.
    a_sparse_ca = ca.DM(a_sparse)
    kappa_ref_dm = ca.DM(kappa_ref)

    n = ca.MX.sym("n", m)
    v = ca.MX.sym("v", m)
    ax_tire = ca.MX.sym("ax_tire", m)

    kappa = kappa_ref_dm + a_sparse_ca @ n
    ay = v * v * kappa
    ay_max = _ay_max_expr(v, vehicle)
    ax_drag = _ax_drag_expr(v, vehicle)
    ax_engine = _ax_engine_expr(v, vehicle)
    ds_path = h * (1.0 - kappa_ref_dm * n)

    v_next = ca.vertcat(v[1:], v[0])
    ax_net = ax_tire - ax_drag
    g_dynamics = v_next * v_next - v * v - 2.0 * ax_net * ds_path
    g_friction = ax_tire * ax_tire + ay * ay - ay_max * ay_max
    g_engine = ax_tire - ax_engine

    lap_time = ca.sum1(2.0 * ds_path / (v + v_next))

    z = ca.vertcat(n, v, ax_tire)
    g = ca.vertcat(g_dynamics, g_friction, g_engine)

    lbg = np.concatenate([np.zeros(m), np.full(m, -np.inf), np.full(m, -np.inf)])
    ubg = np.concatenate([np.zeros(m), np.zeros(m), np.zeros(m)])

    v_top = vehicle.v_top_mps
    lbx = np.concatenate([lb, np.full(m, vehicle.v_floor_mps), np.full(m, -np.inf)])
    ubx = np.concatenate([ub, np.full(m, v_top), np.full(m, np.inf)])

    n0 = np.interp(coarse_s, track.s_m, solve_lateral_offsets(track, margin_m, qp_spacing_m))
    kappa0 = kappa_ref + a_sparse @ n0

    s_closed = np.append(coarse_s, track.loop_length_m)
    kappa_closed = np.append(kappa0, kappa0[0])
    warm_geometry = _CoarseWarmStartGeometry(
        circuit_name=track.circuit_name,
        source_path=track.source_path,
        s_m=s_closed,
        x_m=np.zeros(m + 1),
        y_m=np.zeros(m + 1),
        kappa_1pm=kappa_closed,
    )
    warm_profile = solve_velocity_profile(warm_geometry, vehicle)
    v0 = np.minimum(warm_profile.v_mps[:-1], v_top)
    ax0 = warm_profile.ax_mps2[:-1] + vehicle.ax_drag_mps2(v0)
    z0 = np.concatenate([n0, v0, ax0])

    opts = {
        "ipopt.print_level": 0,
        "print_time": 0,
        "ipopt.max_iter": max_iter,
        "ipopt.sb": "yes",
    }

    def _lap_time_s(n_arr: np.ndarray, v_arr: np.ndarray) -> float:
        """recompute the pure physical lap time from a solved (n, v) pair, numpy-side.

        needed because stage 2's sol["f"] is a smoothness metric, not lap time, and even
        stage 1's sol["f"] is only ever the objective, not guaranteed identical to this
        formula's floating-point result once summed a different way.
        """
        ds_path_arr = h * (1.0 - kappa_ref * n_arr)
        v_next_arr = np.roll(v_arr, -1)
        return float(np.sum(2.0 * ds_path_arr / (v_arr + v_next_arr)))

    # stage 1: minimize pure lap time, exactly as before two_stage existed.
    nlp1 = {"x": z, "f": lap_time, "g": g}
    z_opt, status, n_iterations, solve_time_s = _run_ipopt(nlp1, opts, z0, lbx, ubx, lbg, ubg)
    n_opt, v_opt = z_opt[:m], z_opt[m : 2 * m]
    stage1_lap_time_s = _lap_time_s(n_opt, v_opt)

    if two_stage:
        # stage 2: same physical problem, minimize smoothness of n instead, constrained to
        # not lose more than lap_time_tolerance of stage 1's lap time. Warm-started from
        # stage 1's own optimum, which already sits right at that constraint's boundary.
        #
        # smoothness penalizes n's SECOND difference (n'' via the periodic circulant stencil,
        # the same curvature-style operator D2 already uses elsewhere in this module), not the
        # first difference. Confirmed empirically this distinction matters: a first-difference
        # penalty pushes n toward being flat/constant, but a legitimate racing line crosses a
        # straight diagonally (a smooth ramp with a roughly constant nonzero slope, i.e. zero
        # second difference), and a first-difference penalty can't tell that ramp apart from a
        # real zigzag and fights both, so achieving a visually flat result cost ~10% lap time
        # on the synthetic stadium test. The second-difference version only penalizes actual
        # curvature/oscillation, leaving a constant-slope ramp free.
        n_next = ca.vertcat(n[1:], n[0])
        n_prev = ca.vertcat(n[-1], n[:-1])
        smoothness = ca.sumsqr(n_next - 2.0 * n + n_prev)
        g_lap_time = lap_time - stage1_lap_time_s * (1.0 + lap_time_tolerance)
        g2 = ca.vertcat(g, g_lap_time)
        lbg2 = np.concatenate([lbg, [-np.inf]])
        ubg2 = np.concatenate([ubg, [0.0]])

        nlp2 = {"x": z, "f": smoothness, "g": g2}
        z_opt2, status2, n_iterations2, solve_time_s2 = _run_ipopt(
            nlp2, opts, z_opt, lbx, ubx, lbg2, ubg2
        )
        z_opt = z_opt2
        status = status2
        n_iterations += n_iterations2
        solve_time_s += solve_time_s2

    n_opt, v_opt, ax_tire_opt = z_opt[:m], z_opt[m : 2 * m], z_opt[2 * m :]
    kappa_opt = kappa_ref + a_sparse @ n_opt
    ay_opt = v_opt**2 * kappa_opt
    ay_max_opt = vehicle.ay_max_mps2(v_opt)
    lap_time_s = _lap_time_s(n_opt, v_opt)

    v_closed = np.append(v_opt, v_opt[0])
    assert_closed_loop_velocity(v_closed)

    # margin_m=0.0 here, not margin_m=margin_m: lbx/ubx already baked the margin into the box
    # bounds IPOPT solved against (same lb/ub build_min_curv_qp returned), so re-applying it in
    # this post-hoc check would double-count it and trip on IPOPT's own convergence tolerance
    # landing a hair outside the exact edge, same reasoning offline/mincurv/line.py's
    # margin_m=0.0 call documents.
    w_left_coarse = np.interp(coarse_s, track.s_m, track.w_tr_left_m)
    w_right_coarse = np.interp(coarse_s, track.s_m, track.w_tr_right_m)
    assert_within_track_bounds(n_opt, w_left_coarse, w_right_coarse, margin_m=0.0)
    assert_friction_circle_respected(ax_tire_opt, ay_opt, ay_max_opt)

    old_frac = track.s_m / track.loop_length_m
    new_frac = coarse_s / track.loop_length_m
    x_center = np.interp(new_frac, old_frac, track.x_m, period=1.0)
    y_center = np.interp(new_frac, old_frac, track.y_m, period=1.0)
    heading = np.interp(new_frac, old_frac, track.heading_rad, period=1.0)
    normal_x, normal_y = -np.sin(heading), np.cos(heading)
    x_opt = x_center + n_opt * normal_x
    y_opt = y_center + n_opt * normal_y

    return MinTimeSolution(
        circuit_name=track.circuit_name,
        source_path=track.source_path,
        vehicle=vehicle,
        margin_m=margin_m,
        qp_spacing_m=qp_spacing_m,
        s_m=coarse_s,
        x_m=x_opt,
        y_m=y_opt,
        n_m=n_opt,
        v_mps=v_opt,
        ax_tire_mps2=ax_tire_opt,
        ay_mps2=ay_opt,
        kappa_1pm=kappa_opt,
        lap_time_s=lap_time_s,
        ipopt_status=status,
        n_iterations=n_iterations,
        solve_time_s=solve_time_s,
    )
