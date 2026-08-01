"""forward-backward velocity profile solver on a fixed closed path.

reimplements the algorithm structure of TUMFTM's trajectory_planning_helpers.calc_vel_profile
(apex-seeded forward/backward integration, double-lap trick for the closed-loop periodic
boundary condition, pointwise-min composition) from the published methodology -- not imported,
per docs/DESIGN_NOTES.md's licensing reasoning (algorithms aren't copyrightable, the specific
LGPL code is).

M8 changed two things about the physics this drives.

1. the road is no longer flat. every segment carries a grade angle theta and a vertical
   curvature kappa_v derived from the elevation profile, and both passes carry a g*sin(theta)
   term. the integration step uses the 3D segment length dl, not the planar ds.

2. ay_max is no longer closed form. TUM's ay_max(v) comes from a tabulated ggv diagram
   requiring iterative fixed-point convergence, and before M8 ours was a closed-form
   mu*(g + downforce/m) that solved the lateral speed cap in one step. load sensitivity makes
   Fz^(1-k) non-quadratic in v^2 and load transfer makes ay_max depend on ax, so the cap is now
   a fixed point on v (CAP_ITERS) and the longitudinal budget is a fixed point on the tyre
   longitudinal acceleration (LOAD_TRANSFER_ITERS). we have converged on TUM's shape by a
   different route, for a different reason.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from offline.geometry.raceline import RacelineGeometry
from offline.velocity.vehicle import (
    CAP_ITERS,
    DEFAULT_GT3,
    LOAD_TRANSFER_ITERS,
    GT3Vehicle,
)

PHASE_ACCEL_THRESHOLD_G = 0.05

# window over which the vertical curvature is averaged. kappa_v is a second derivative of an
# already smoothed elevation profile, so without this it is dominated by resampling noise.
# 25 m is about a car length either side of a point: short enough to keep Eau Rouge's
# compression and the Raidillon crest, long enough to kill the 1 m grid ripple.
KAPPA_V_SMOOTH_WINDOW_M = 25.0


@dataclass(frozen=True)
class VelocityProfile:
    circuit_name: str
    source_path: Path
    vehicle: GT3Vehicle
    s_m: np.ndarray
    x_m: np.ndarray
    y_m: np.ndarray
    z_m: np.ndarray
    kappa_1pm: np.ndarray
    v_mps: np.ndarray
    ax_mps2: np.ndarray
    ay_mps2: np.ndarray
    phase: np.ndarray
    lap_time_s: float
    # M8 channels, all closed-duplicate like the arrays above
    grade_rad: np.ndarray
    kappa_v_1pm: np.ndarray
    dl_m: np.ndarray
    fz_front_n: np.ndarray
    fz_rear_n: np.ndarray
    grip_util_front: np.ndarray
    grip_util_rear: np.ndarray

    @property
    def loop_length_m(self) -> float:
        return float(self.s_m[-1])

    @property
    def path_length_m(self) -> float:
        """true 3D distance travelled, which exceeds the planar loop length on a graded circuit."""
        return float(np.sum(self.dl_m[:-1]))

    def to_json_dict(self) -> dict:
        v = self.vehicle
        return {
            "schema_version": 2,
            "meta": {
                "circuit_name": self.circuit_name,
                "source": str(self.source_path),
                "source_license": "TUMFTM/racetrack-database, LGPL-3.0",
                "loop_length_m": self.loop_length_m,
                "path_length_m": self.path_length_m,
                "lap_time_s": self.lap_time_s,
                "load_transfer_iters": LOAD_TRANSFER_ITERS,
                "cap_iters": CAP_ITERS,
                "vehicle": vehicle_to_json_dict(v),
            },
            "profile": {
                "s_m": self.s_m.tolist(),
                "x_m": self.x_m.tolist(),
                "y_m": self.y_m.tolist(),
                "z_m": self.z_m.tolist(),
                "kappa_1pm": self.kappa_1pm.tolist(),
                "v_mps": self.v_mps.tolist(),
                "ax_mps2": self.ax_mps2.tolist(),
                "ay_mps2": self.ay_mps2.tolist(),
                "phase": self.phase.tolist(),
                "grade_rad": self.grade_rad.tolist(),
                "kappa_v_1pm": self.kappa_v_1pm.tolist(),
                "fz_front_n": self.fz_front_n.tolist(),
                "fz_rear_n": self.fz_rear_n.tolist(),
                "grip_util_front": self.grip_util_front.tolist(),
                "grip_util_rear": self.grip_util_rear.tolist(),
            },
        }


def vehicle_to_json_dict(v: GT3Vehicle) -> dict:
    """the one place vehicle constants are serialised, so the viewer and the artifacts agree."""
    return {
        "mass_kg": v.mass_kg,
        "mu": v.mu,
        "downforce_area_m2": v.downforce_area_m2,
        "drag_area_m2": v.drag_area_m2,
        "power_w": v.power_w,
        "air_density_kgpm3": v.air_density_kgpm3,
        "g_mps2": v.g_mps2,
        "v_floor_mps": v.v_floor_mps,
        "wheelbase_m": v.wheelbase_m,
        "cg_height_m": v.cg_height_m,
        "weight_dist_front": v.weight_dist_front,
        "brake_bias_front": v.brake_bias_front,
        "tyre_load_sensitivity": v.tyre_load_sensitivity,
        "aero_balance_front": v.aero_balance_front,
        "fz_floor_frac": v.fz_floor_frac,
        "drive_axle": v.drive_axle,
    }


def _circular_boxcar(values: np.ndarray, window_samples: int) -> np.ndarray:
    """moving average around a closed loop, so the smoothing has no seam at s=0."""
    if window_samples <= 1:
        return values
    pad = window_samples
    padded = np.concatenate([values[-pad:], values, values[:pad]])
    kernel = np.full(window_samples, 1.0 / window_samples)
    smoothed = np.convolve(padded, kernel, mode="same")
    return smoothed[pad:-pad]


def grade_channels(
    s_m: np.ndarray, z_m: np.ndarray, smooth_window_m: float = KAPPA_V_SMOOTH_WINDOW_M
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """(sin_theta, cos_theta, dl_m, kappa_v_1pm), one value per segment of a closed loop.

    theta is the raw finite difference atan2(dz, ds) with no extra smoothing. that is
    deliberate: sin(theta)*dl == dz identically, so the gravity term integrates to exactly
    zero around the lap and the closed-loop energy books balance to float precision. smoothing
    theta would break that identity for no gain, since z already comes off a smoothing spline.

    kappa_v = d(theta)/ds is a second derivative and does need averaging; see
    KAPPA_V_SMOOTH_WINDOW_M. positive kappa_v is a compression (a valley), negative is a crest.
    """
    ds = np.diff(s_m)
    dz = np.diff(z_m)
    if np.any(ds <= 0.0):
        raise ValueError("s_m must be strictly increasing to derive grade channels")

    dl = np.hypot(ds, dz)
    sin_theta = dz / dl
    cos_theta = ds / dl

    theta = np.arctan2(dz, ds)
    span = ds + 0.5 * (np.roll(ds, -1) + np.roll(ds, 1))
    kappa_v = (np.roll(theta, -1) - np.roll(theta, 1)) / span

    window = max(1, int(round(smooth_window_m / float(np.mean(ds)))))
    if window % 2 == 0:
        window += 1
    kappa_v = _circular_boxcar(kappa_v, window)

    return sin_theta, cos_theta, dl, kappa_v


def lateral_speed_cap_mps(
    kappa_abs_1pm: np.ndarray,
    vehicle: GT3Vehicle,
    sin_theta: np.ndarray | None = None,
    cos_theta: np.ndarray | None = None,
    kappa_v_1pm: np.ndarray | None = None,
) -> np.ndarray:
    """cornering speed ceiling: the v where all available tyre grip is spent laterally.

    solves m*v^2*|kappa| = G_front(v) + G_rear(v) at zero longitudinal tyre force. the pre-M8
    closed form is gone (Fz^(1-k) is not quadratic in v^2) so this is a fixed point on v,
    seeded from that closed form and iterated CAP_ITERS times.

    it is a rigorous upper bound, not an estimate: by the Jensen argument in
    GT3Vehicle.ay_max_mps2, ax_tyre = 0 maximises the total lateral grip available. load
    sensitivity also removes the old degenerate case entirely: G now grows like v^1.8 rather
    than v^2, so a finite root always exists and no corner is ever aero-unlimited.
    """
    kappa_abs = np.atleast_1d(np.asarray(kappa_abs_1pm, dtype=float))
    sin_t = np.zeros_like(kappa_abs) if sin_theta is None else np.asarray(sin_theta, dtype=float)
    cos_t = np.ones_like(kappa_abs) if cos_theta is None else np.asarray(cos_theta, dtype=float)
    kappa_v = (
        np.zeros_like(kappa_abs) if kappa_v_1pm is None else np.asarray(kappa_v_1pm, dtype=float)
    )

    v_top = vehicle.v_top_mps

    # seed from the pre-M8 closed form: mu*(m*g + 0.5*rho*ClA*v^2) = m*v^2*|kappa|
    denom = vehicle.mass_kg * kappa_abs - vehicle.mu * vehicle.downforce_coeff
    v_cap = np.full_like(kappa_abs, v_top)
    seeded = denom > 1e-9
    v_cap[seeded] = np.sqrt(vehicle.mu * vehicle.mass_kg * vehicle.g_mps2 / denom[seeded])
    v_cap = np.minimum(v_cap, v_top)

    kappa_safe = np.maximum(kappa_abs, 1e-12)
    for _ in range(CAP_ITERS):
        fz_front, fz_rear = vehicle.axle_loads_n(v_cap, 0.0, sin_t, cos_t, kappa_v)
        grip_front, grip_rear = vehicle.axle_grip_n(fz_front, fz_rear)
        v_cap = np.minimum(
            np.sqrt((grip_front + grip_rear) / (vehicle.mass_kg * kappa_safe)), v_top
        )

    return v_cap


def ax_budget_mps2(
    v_mps: float,
    kappa_abs_1pm: float,
    vehicle: GT3Vehicle,
    mode: str,
    sin_theta: float = 0.0,
    cos_theta: float = 1.0,
    kappa_v_1pm: float = 0.0,
) -> float:
    """per-point longitudinal accel budget: our calc_ax_poss equivalent.

    the friction circle is now per axle (see GT3Vehicle), but the lateral demand is split in
    proportion to axle grip, so when brake bias happens to match the load split this collapses
    exactly onto the single lumped circle used before M8.

    Fz depends on the tyre longitudinal acceleration and the tyre longitudinal acceleration
    depends on Fz, so this is a fixed point. see LOAD_TRANSFER_ITERS in vehicle.py for why it
    runs four passes and not three; the count is measured in test_loads.py rather than asserted.
    """
    if mode not in ("accel_forw", "decel_backw"):
        raise ValueError(f"unknown mode {mode!r}")
    braking = mode == "decel_backw"

    fy_needed = vehicle.mass_kg * v_mps**2 * kappa_abs_1pm
    ax_drag = float(vehicle.ax_drag_mps2(v_mps))
    ax_grade = vehicle.g_mps2 * sin_theta

    ax_tyre = 0.0  # seed: no load transfer
    for _ in range(LOAD_TRANSFER_ITERS):
        fz_front, fz_rear = vehicle.axle_loads_n(
            v_mps, ax_tyre, sin_theta, cos_theta, kappa_v_1pm
        )
        grip_front, grip_rear = vehicle.axle_grip_n(fz_front, fz_rear)
        fx_front, fx_rear = vehicle.longitudinal_capacity_n(grip_front, grip_rear, fy_needed)
        if braking:
            # the transfer must see the true signed accel. drop this negation and the car
            # loads its rear axle under braking, which produces a car that brakes better the
            # harder it brakes.
            ax_tyre = -float(vehicle.ax_brake_mps2(fx_front, fx_rear))
        else:
            ax_tyre = min(
                float(vehicle.ax_traction_mps2(fx_front, fx_rear)),
                float(vehicle.ax_engine_mps2(v_mps)),
            )

    if braking:
        # returned as a positive magnitude, because the backward pass integrates in the
        # reversed travel direction. gravity on an uphill helps you slow so it adds; on a
        # downhill sin_theta is already negative. there is no extra sign flip in the reversed
        # indexing, and getting that wrong is the single easiest mistake in this file.
        return -ax_tyre + ax_drag + ax_grade
    return ax_tyre - ax_drag - ax_grade


def _acceleration_phase_starts(v_profile: np.ndarray) -> list[int]:
    """indices where v_profile steps upward: the start of each acceleration phase."""
    diffs = np.diff(v_profile)
    up_inds = np.where(diffs > 0.0)[0]
    if up_inds.size == 0:
        return []
    up_inds_gaps = np.insert(np.diff(up_inds), 0, 2)
    return list(up_inds[up_inds_gaps > 1])


def _integrate_pass(
    v_profile: np.ndarray,
    kappa_abs_1pm: np.ndarray,
    dl_m: np.ndarray,
    sin_theta: np.ndarray,
    cos_theta: np.ndarray,
    kappa_v_1pm: np.ndarray,
    vehicle: GT3Vehicle,
    mode: str,
    backwards: bool,
) -> np.ndarray:
    """one forward accel or backward brake pass, composed as pointwise-minimum."""
    n = len(v_profile)
    if backwards:
        kappa_mod = kappa_abs_1pm[::-1]
        dl_mod = dl_m[::-1]
        sin_mod = sin_theta[::-1]
        cos_mod = cos_theta[::-1]
        kappa_v_mod = kappa_v_1pm[::-1]
        v_profile = v_profile[::-1].copy()
    else:
        kappa_mod = kappa_abs_1pm
        dl_mod = dl_m
        sin_mod = sin_theta
        cos_mod = cos_theta
        kappa_v_mod = kappa_v_1pm
        v_profile = v_profile.copy()

    starts = _acceleration_phase_starts(v_profile)
    while starts:
        i = starts.pop(0)
        while i < n - 1:
            ax = ax_budget_mps2(
                v_profile[i], kappa_mod[i], vehicle, mode, sin_mod[i], cos_mod[i], kappa_v_mod[i]
            )
            v_next = math.sqrt(max(v_profile[i] ** 2 + 2 * ax * dl_mod[i], 0.0))

            if backwards:
                # refine once: ax at i+1 differs from ax at i (radius, speed, grade all change)
                ax_next = ax_budget_mps2(
                    v_next,
                    kappa_mod[i + 1],
                    vehicle,
                    mode,
                    sin_mod[i + 1],
                    cos_mod[i + 1],
                    kappa_v_mod[i + 1],
                )
                v_refined = math.sqrt(max(v_profile[i] ** 2 + 2 * ax_next * dl_mod[i], 0.0))
                if v_refined < v_next:
                    v_next = v_refined

            if v_next < v_profile[i + 1]:
                v_profile[i + 1] = v_next

            i += 1
            if v_next > vehicle.v_top_mps or (starts and i >= starts[0]):
                break

    if backwards:
        v_profile = v_profile[::-1]
    return v_profile


def axle_diagnostics(
    v_mps: np.ndarray,
    ax_mps2: np.ndarray,
    kappa_1pm: np.ndarray,
    sin_theta: np.ndarray,
    cos_theta: np.ndarray,
    kappa_v_1pm: np.ndarray,
    vehicle: GT3Vehicle,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """(Fz_front, Fz_rear, util_front, util_rear) evaluated on the solved profile.

    utilisation is the resultant tyre force on an axle over that axle's grip capacity. the
    higher of the two names the limiting axle, which is the readout that makes the whole
    two-axle model visible in the viewer.
    """
    # the tyres must supply the net acceleration plus everything resisting it
    ax_tyre = ax_mps2 + vehicle.ax_drag_mps2(v_mps) + vehicle.g_mps2 * sin_theta
    fz_front, fz_rear = vehicle.axle_loads_n(
        v_mps, ax_tyre, sin_theta, cos_theta, kappa_v_1pm
    )
    grip_front, grip_rear = vehicle.axle_grip_n(fz_front, fz_rear)

    fy_needed = vehicle.mass_kg * v_mps**2 * np.abs(kappa_1pm)
    fy_front, fy_rear = vehicle.lateral_shares(grip_front, grip_rear, fy_needed)

    fx_total = vehicle.mass_kg * ax_tyre
    driving = fx_total >= 0.0
    bias = vehicle.brake_bias_front
    fx_front = np.where(driving, 0.0 if vehicle.drive_axle == "rear" else fx_total, bias * fx_total)
    fx_rear = np.where(
        driving, fx_total if vehicle.drive_axle == "rear" else 0.0, (1.0 - bias) * fx_total
    )

    util_front = np.hypot(fx_front, fy_front) / grip_front
    util_rear = np.hypot(fx_rear, fy_rear) / grip_rear
    return fz_front, fz_rear, util_front, util_rear


def solve_velocity_profile(
    geometry: RacelineGeometry, vehicle: GT3Vehicle = DEFAULT_GT3
) -> VelocityProfile:
    """solve v(s), a_x(s), a_y(s), lap time, phase labels and axle loads on a closed path."""
    kappa_abs = np.abs(geometry.kappa_1pm[:-1])
    n = len(kappa_abs)

    sin_theta, cos_theta, dl_m, kappa_v = grade_channels(geometry.s_m, geometry.z_m)

    v_cap = lateral_speed_cap_mps(kappa_abs, vehicle, sin_theta, cos_theta, kappa_v)

    # double lap for the closed-loop periodic boundary condition (TUM's proven trick):
    # run each pass over two concatenated laps, keep only the second lap's result.
    def doubled(a: np.ndarray) -> np.ndarray:
        return np.concatenate([a, a])

    v_double = doubled(v_cap)
    kappa_double = doubled(kappa_abs)
    dl_double = doubled(dl_m)
    sin_double = doubled(sin_theta)
    cos_double = doubled(cos_theta)
    kappa_v_double = doubled(kappa_v)

    v_double = _integrate_pass(
        v_double,
        kappa_double,
        dl_double,
        sin_double,
        cos_double,
        kappa_v_double,
        vehicle,
        "accel_forw",
        False,
    )
    v_double = np.concatenate([v_double[n:], v_double[n:]])
    v_double = _integrate_pass(
        v_double,
        kappa_double,
        dl_double,
        sin_double,
        cos_double,
        kappa_v_double,
        vehicle,
        "decel_backw",
        True,
    )
    v_unclosed = v_double[n:]

    v_mps = np.append(v_unclosed, v_unclosed[0])

    # ax and lap time both integrate the 3D segment length, not the planar one
    ax_segment = (v_mps[1:] ** 2 - v_mps[:-1] ** 2) / (2 * dl_m)
    ax_mps2 = np.append(ax_segment, ax_segment[0])
    ay_mps2 = v_mps**2 * geometry.kappa_1pm

    threshold = PHASE_ACCEL_THRESHOLD_G * vehicle.g_mps2
    phase = np.where(
        ax_mps2 > threshold, "accel", np.where(ax_mps2 < -threshold, "brake", "coast")
    )

    lap_time_s = float(np.sum(2 * dl_m / (v_mps[:-1] + v_mps[1:])))

    def closed(a: np.ndarray) -> np.ndarray:
        return np.append(a, a[0])

    grade_rad = closed(np.arcsin(sin_theta))
    kappa_v_closed = closed(kappa_v)
    fz_front, fz_rear, util_front, util_rear = axle_diagnostics(
        v_mps,
        ax_mps2,
        geometry.kappa_1pm,
        closed(sin_theta),
        closed(cos_theta),
        kappa_v_closed,
        vehicle,
    )

    return VelocityProfile(
        circuit_name=geometry.circuit_name,
        source_path=geometry.source_path,
        vehicle=vehicle,
        s_m=geometry.s_m,
        x_m=geometry.x_m,
        y_m=geometry.y_m,
        z_m=geometry.z_m,
        kappa_1pm=geometry.kappa_1pm,
        v_mps=v_mps,
        ax_mps2=ax_mps2,
        ay_mps2=ay_mps2,
        phase=phase,
        lap_time_s=lap_time_s,
        grade_rad=grade_rad,
        kappa_v_1pm=kappa_v_closed,
        dl_m=closed(dl_m),
        fz_front_n=fz_front,
        fz_rear_n=fz_rear,
        grip_util_front=util_front,
        grip_util_rear=util_rear,
    )
