"""forward-backward velocity profile solver on a fixed closed path.

reimplements the algorithm structure of TUMFTM's trajectory_planning_helpers.calc_vel_profile
(apex-seeded forward/backward integration, double-lap trick for the closed-loop periodic
boundary condition, pointwise-min composition) from the published methodology -- not imported,
per docs/DESIGN_NOTES.md's licensing reasoning (algorithms aren't copyrightable, the specific
LGPL code is). The one material difference: TUM's ay_max(v) comes from a tabulated ggv diagram
requiring iterative fixed-point convergence; ours is a closed-form mu*(g + downforce/m), so the
lateral speed cap below solves in one step, no iteration needed.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from offline.geometry.raceline import RacelineGeometry
from offline.velocity.vehicle import DEFAULT_GT3, GT3Vehicle

PHASE_ACCEL_THRESHOLD_G = 0.05


@dataclass(frozen=True)
class VelocityProfile:
    circuit_name: str
    source_path: Path
    vehicle: GT3Vehicle
    s_m: np.ndarray
    x_m: np.ndarray
    y_m: np.ndarray
    kappa_1pm: np.ndarray
    v_mps: np.ndarray
    ax_mps2: np.ndarray
    ay_mps2: np.ndarray
    phase: np.ndarray
    lap_time_s: float

    @property
    def loop_length_m(self) -> float:
        return float(self.s_m[-1])

    def to_json_dict(self) -> dict:
        v = self.vehicle
        return {
            "schema_version": 1,
            "meta": {
                "circuit_name": self.circuit_name,
                "source": str(self.source_path),
                "source_license": "TUMFTM/racetrack-database, LGPL-3.0",
                "loop_length_m": self.loop_length_m,
                "lap_time_s": self.lap_time_s,
                "vehicle": {
                    "mass_kg": v.mass_kg,
                    "mu": v.mu,
                    "downforce_area_m2": v.downforce_area_m2,
                    "drag_area_m2": v.drag_area_m2,
                    "power_w": v.power_w,
                    "air_density_kgpm3": v.air_density_kgpm3,
                    "g_mps2": v.g_mps2,
                    "v_top_mps": v.v_top_mps,
                },
            },
            "profile": {
                "s_m": self.s_m.tolist(),
                "x_m": self.x_m.tolist(),
                "y_m": self.y_m.tolist(),
                "kappa_1pm": self.kappa_1pm.tolist(),
                "v_mps": self.v_mps.tolist(),
                "ax_mps2": self.ax_mps2.tolist(),
                "ay_mps2": self.ay_mps2.tolist(),
                "phase": self.phase.tolist(),
            },
        }


def lateral_speed_cap_mps(kappa_abs_1pm: np.ndarray, vehicle: GT3Vehicle) -> np.ndarray:
    """closed-form cornering speed ceiling: mu*(m*g + 0.5*rho*C_L*A*v^2) = m*v^2*|kappa|.

    quadratic in v^2, solves in one step. When the denominator is non-positive (downforce
    grows with v^2 at least as fast as cornering demand does -- possible for very gentle
    high-speed corners), the corner is aero-unlimited at any finite speed; cap at v_top_mps
    (the drag/engine equilibrium speed) rather than returning infinity.
    """
    downforce_coeff = 0.5 * vehicle.air_density_kgpm3 * vehicle.downforce_area_m2
    denom = vehicle.mass_kg * kappa_abs_1pm - vehicle.mu * downforce_coeff
    v_cap = np.full_like(kappa_abs_1pm, vehicle.v_top_mps, dtype=float)
    valid = denom > 1e-9
    v_cap[valid] = np.sqrt(vehicle.mu * vehicle.mass_kg * vehicle.g_mps2 / denom[valid])
    return np.minimum(v_cap, vehicle.v_top_mps)


def ax_budget_mps2(v_mps: float, kappa_abs_1pm: float, vehicle: GT3Vehicle, mode: str) -> float:
    """per-point longitudinal accel budget: our calc_ax_poss equivalent.

    friction circle (ax/ax_max)^2 + (ay/ay_max)^2 = 1, matching DESIGN_NOTES' explicit
    "friction circle" wording rather than a more conservative diamond combination.
    """
    if mode not in ("accel_forw", "decel_backw"):
        raise ValueError(f"unknown mode {mode!r}")

    ay_max = vehicle.ay_max_mps2(v_mps)
    ay_used = v_mps**2 * kappa_abs_1pm
    ratio = ay_used / ay_max if ay_max > 0.0 else 1.0
    radicand = 1.0 - ratio**2
    ax_tires = ay_max * math.sqrt(radicand) if radicand > 0.0 else 0.0
    ax_drag = vehicle.ax_drag_mps2(v_mps)

    if mode == "accel_forw":
        return min(ax_tires, vehicle.ax_engine_mps2(v_mps)) - ax_drag
    return ax_tires + ax_drag  # decel_backw: braking is purely tire-limited, no engine term


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
    el_lengths_m: np.ndarray,
    vehicle: GT3Vehicle,
    mode: str,
    backwards: bool,
) -> np.ndarray:
    """one forward accel or backward brake pass, composed as pointwise-minimum."""
    n = len(v_profile)
    if backwards:
        kappa_mod = kappa_abs_1pm[::-1]
        el_mod = el_lengths_m[::-1]
        v_profile = v_profile[::-1].copy()
    else:
        kappa_mod = kappa_abs_1pm
        el_mod = el_lengths_m
        v_profile = v_profile.copy()

    starts = _acceleration_phase_starts(v_profile)
    while starts:
        i = starts.pop(0)
        while i < n - 1:
            ax = ax_budget_mps2(v_profile[i], kappa_mod[i], vehicle, mode)
            v_next = math.sqrt(max(v_profile[i] ** 2 + 2 * ax * el_mod[i], 0.0))

            if backwards:
                # refine once: ax at i+1 differs from ax at i (radius, speed both change)
                ax_next = ax_budget_mps2(v_next, kappa_mod[i + 1], vehicle, mode)
                v_refined = math.sqrt(max(v_profile[i] ** 2 + 2 * ax_next * el_mod[i], 0.0))
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


def solve_velocity_profile(
    geometry: RacelineGeometry, vehicle: GT3Vehicle = DEFAULT_GT3
) -> VelocityProfile:
    """solve v(s), a_x(s), a_y(s), lap time, and phase labels on a fixed closed path."""
    kappa_abs = np.abs(geometry.kappa_1pm[:-1])
    el_lengths = np.diff(geometry.s_m)
    n = len(kappa_abs)

    v_cap = lateral_speed_cap_mps(kappa_abs, vehicle)

    # double lap for the closed-loop periodic boundary condition (TUM's proven trick):
    # run each pass over two concatenated laps, keep only the second lap's result.
    v_double = np.concatenate([v_cap, v_cap])
    kappa_double = np.concatenate([kappa_abs, kappa_abs])
    el_double = np.concatenate([el_lengths, el_lengths])

    v_double = _integrate_pass(v_double, kappa_double, el_double, vehicle, "accel_forw", False)
    v_double = np.concatenate([v_double[n:], v_double[n:]])
    v_double = _integrate_pass(v_double, kappa_double, el_double, vehicle, "decel_backw", True)
    v_unclosed = v_double[n:]

    v_mps = np.append(v_unclosed, v_unclosed[0])

    ax_segment = (v_mps[1:] ** 2 - v_mps[:-1] ** 2) / (2 * el_lengths)
    ax_mps2 = np.append(ax_segment, ax_segment[0])
    ay_mps2 = v_mps**2 * geometry.kappa_1pm

    threshold = PHASE_ACCEL_THRESHOLD_G * vehicle.g_mps2
    phase = np.where(
        ax_mps2 > threshold, "accel", np.where(ax_mps2 < -threshold, "brake", "coast")
    )

    lap_time_s = float(np.sum(2 * el_lengths / (v_mps[:-1] + v_mps[1:])))

    return VelocityProfile(
        circuit_name=geometry.circuit_name,
        source_path=geometry.source_path,
        vehicle=vehicle,
        s_m=geometry.s_m,
        x_m=geometry.x_m,
        y_m=geometry.y_m,
        kappa_1pm=geometry.kappa_1pm,
        v_mps=v_mps,
        ax_mps2=ax_mps2,
        ay_mps2=ay_mps2,
        phase=phase,
        lap_time_s=lap_time_s,
    )
