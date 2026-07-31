"""M1-M5 deliverable plots: geometry/velocity/elevation sanity views, line comparisons,
mu-grid results."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.collections import LineCollection

from offline.elevation.profile import ElevationProfile
from offline.geometry.pipeline import TrackGeometry
from offline.geometry.raceline import RacelineGeometry
from offline.mincurv.line import OptimizedLine
from offline.velocity.solver import VelocityProfile

if TYPE_CHECKING:
    # casadi (offline/reference/mintime.py's dependency) is an optional extra, so this module
    # must stay importable without it: MinTimeSolution is a type-only import.
    from offline.reference.mintime import MinTimeSolution

PHASE_COLORS = {"accel": "#2ca02c", "brake": "#d62728", "coast": "#dddddd"}


def plot_curvature(track: TrackGeometry, output_path: Path) -> None:
    """save a kappa(s) plot, self-documenting with the smoothing parameters used.

    intended for the M1 visual check: does curvature match expectation for the circuit's
    known corners, with clean near-zero readings on the straights.
    """
    fig, ax = plt.subplots(figsize=(10, 4))
    ax.plot(track.s_m, track.kappa_1pm, linewidth=0.8)
    ax.axhline(0.0, color="black", linewidth=0.5)
    ax.set_xlabel("s [m]")
    ax.set_ylabel("kappa [1/m]")
    ax.set_title(
        f"{track.circuit_name} curvature profile "
        f"(spacing={track.spacing_m} m, gps_noise_std={track.gps_noise_std_m} m, "
        f"s={track.smoothing_factor:.2f})"
    )
    fig.tight_layout()
    fig.savefig(output_path, dpi=300)
    plt.close(fig)


def plot_boundaries(track: TrackGeometry, output_path: Path) -> None:
    """save centerline + both boundaries, for a human eyeball check that left/right land
    on the geometrically correct side.
    """
    fig, ax = plt.subplots(figsize=(8, 8))
    ax.plot(track.x_m, track.y_m, linewidth=0.8, label="centerline")
    ax.plot(track.boundary_left_x_m, track.boundary_left_y_m, linewidth=0.6, label="left boundary")
    ax.plot(
        track.boundary_right_x_m, track.boundary_right_y_m, linewidth=0.6, label="right boundary"
    )
    ax.set_aspect("equal")
    ax.set_title(f"{track.circuit_name} boundaries")
    ax.legend()
    fig.tight_layout()
    fig.savefig(output_path, dpi=300)
    plt.close(fig)


def _shade_phases(ax, s_m: np.ndarray, phase: np.ndarray) -> None:
    """background-shade contiguous phase runs so brake/accel zones are visible at a glance."""
    change_points = np.nonzero(phase[1:] != phase[:-1])[0] + 1
    run_starts = np.concatenate([[0], change_points])
    run_ends = np.concatenate([change_points, [len(phase) - 1]])
    for start, end in zip(run_starts, run_ends):
        ax.axvspan(s_m[start], s_m[end], color=PHASE_COLORS[phase[start]], alpha=0.3, linewidth=0)


def plot_velocity(profile: VelocityProfile, output_path: Path) -> None:
    """save stacked v(s)/a_x(s)/a_y(s) traces, phase-shaded, for the M2 visual check."""
    fig, (ax_v, ax_ax, ax_ay) = plt.subplots(3, 1, figsize=(10, 8), sharex=True)

    for ax in (ax_v, ax_ax, ax_ay):
        _shade_phases(ax, profile.s_m, profile.phase)

    ax_v.plot(profile.s_m, profile.v_mps * 3.6, linewidth=0.8, color="black")
    ax_v.set_ylabel("v [km/h]")

    ax_ax.plot(profile.s_m, profile.ax_mps2, linewidth=0.8, color="black")
    ax_ax.axhline(0.0, color="black", linewidth=0.5)
    ax_ax.set_ylabel("a_x [m/s2]")

    ax_ay.plot(profile.s_m, profile.ay_mps2, linewidth=0.8, color="black")
    ax_ay.axhline(0.0, color="black", linewidth=0.5)
    ax_ay.set_ylabel("a_y [m/s2]")
    ax_ay.set_xlabel("s [m]")

    fig.suptitle(f"{profile.circuit_name} velocity profile (lap time {profile.lap_time_s:.2f} s)")
    fig.tight_layout()
    fig.savefig(output_path, dpi=300)
    plt.close(fig)


def plot_line_comparison(
    track: TrackGeometry,
    mincurv_line: OptimizedLine,
    reference_raceline: RacelineGeometry,
    output_path: Path,
) -> None:
    """save centerline + TUM's raceline + our minimum-curvature line, overlaid.

    the direct "your line vs TUM's" visual for M3's deliverable.
    """
    fig, ax = plt.subplots(figsize=(8, 8))
    ax.plot(track.x_m, track.y_m, linewidth=0.6, color="#999999", label="centerline")
    ax.plot(
        reference_raceline.x_m, reference_raceline.y_m, linewidth=1.0, label="TUM raceline"
    )
    ax.plot(mincurv_line.x_m, mincurv_line.y_m, linewidth=1.0, label="our min-curvature line")
    ax.set_aspect("equal")
    ax.set_title(f"{track.circuit_name}: our line vs TUM's raceline")
    ax.legend()
    fig.tight_layout()
    fig.savefig(output_path, dpi=300)
    plt.close(fig)


def plot_lateral_offset(mincurv_line: OptimizedLine, output_path: Path) -> None:
    """save alpha(s) (lateral offset from the centerline) vs arc length, same style as
    plot_curvature -- shows where and how much the optimized line pulls off-centre.
    """
    fig, ax = plt.subplots(figsize=(10, 4))
    ax.plot(mincurv_line.s_m, mincurv_line.lateral_offset_m, linewidth=0.8)
    ax.axhline(0.0, color="black", linewidth=0.5)
    ax.set_xlabel("s [m]")
    ax.set_ylabel("lateral offset [m] (+ = left)")
    ax.set_title(f"{mincurv_line.circuit_name} minimum-curvature lateral offset")
    fig.tight_layout()
    fig.savefig(output_path, dpi=300)
    plt.close(fig)


def plot_lap_time_vs_mu(mu_values: np.ndarray, lap_times_s: np.ndarray, output_path: Path) -> None:
    """save lap time vs grip coefficient, the M4 mu-grid deliverable plot."""
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.plot(mu_values, lap_times_s, marker="o", linewidth=0.8, color="black")
    ax.set_xlabel("mu")
    ax.set_ylabel("lap time [s]")
    ax.set_title("minimum-time lap time vs grip")
    fig.tight_layout()
    fig.savefig(output_path, dpi=300)
    plt.close(fig)


def plot_mintime_line(track: TrackGeometry, solution: "MinTimeSolution", output_path: Path) -> None:
    """save centerline + the min-time NLP's solved line, overlaid, for one representative mu.

    unlike plot_line_comparison there's no TUM-raceline overlay here: TUM's supplied raceline
    is grip-invariant/fixed, not a reference for a specific mu.
    """
    fig, ax = plt.subplots(figsize=(8, 8))
    ax.plot(track.x_m, track.y_m, linewidth=0.6, color="#999999", label="centerline")
    ax.plot(solution.x_m, solution.y_m, linewidth=1.0, label=f"min-time line (mu={solution.vehicle.mu:g})")
    ax.set_aspect("equal")
    ax.set_title(f"{track.circuit_name}: min-time line (lap time {solution.lap_time_s:.2f} s)")
    ax.legend()
    fig.tight_layout()
    fig.savefig(output_path, dpi=300)
    plt.close(fig)


def plot_speed_map(profile: VelocityProfile, output_path: Path) -> None:
    """save a 2D track map colored by speed, F1-TV-style."""
    points = np.column_stack([profile.x_m, profile.y_m]).reshape(-1, 1, 2)
    segments = np.concatenate([points[:-1], points[1:]], axis=1)

    fig, ax = plt.subplots(figsize=(8, 8))
    line_collection = LineCollection(segments, cmap="viridis", linewidth=3)
    line_collection.set_array(profile.v_mps[:-1] * 3.6)
    ax.add_collection(line_collection)
    ax.autoscale()
    ax.set_aspect("equal")
    ax.set_title(f"{profile.circuit_name} speed map (lap time {profile.lap_time_s:.2f} s)")

    colorbar = fig.colorbar(line_collection, ax=ax)
    colorbar.set_label("speed [km/h]")

    fig.tight_layout()
    fig.savefig(output_path, dpi=300)
    plt.close(fig)


def plot_elevation_profile(
    track: TrackGeometry, elevation: "ElevationProfile", output_path: Path
) -> None:
    """save the M5 elevation deliverable: z(s) profile plus a track map colored by elevation.

    the map panel is what makes the profile checkable at a glance -- Eau Rouge/Raidillon
    should light up as the steep low-to-high transition right after the La Source hairpin,
    in the right *place*, not just with the right magnitude.
    """
    fig, (ax_profile, ax_map) = plt.subplots(
        1, 2, figsize=(14, 6), gridspec_kw={"width_ratios": [1.3, 1]}
    )

    ax_profile.plot(elevation.s_m, elevation.z_m, linewidth=1.0, color="black")
    ax_profile.set_xlabel("s [m]")
    ax_profile.set_ylabel("relative elevation [m]")
    ax_profile.set_title(
        f"{elevation.circuit_name} elevation profile "
        f"(range {elevation.total_range_m:.0f} m, shape only)"
    )
    ax_profile.grid(linewidth=0.3)

    points = np.column_stack([track.x_m, track.y_m]).reshape(-1, 1, 2)
    segments = np.concatenate([points[:-1], points[1:]], axis=1)
    line_collection = LineCollection(segments, cmap="terrain", linewidth=3)
    line_collection.set_array(elevation.z_m[:-1])
    ax_map.add_collection(line_collection)
    ax_map.autoscale()
    ax_map.set_aspect("equal")
    ax_map.set_title("track map colored by elevation")
    colorbar = fig.colorbar(line_collection, ax=ax_map)
    colorbar.set_label("relative elevation [m]")

    fig.tight_layout()
    fig.savefig(output_path, dpi=300)
    plt.close(fig)
