"""M1 deliverable plots: the kappa(s) curvature profile and a boundary sanity view."""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt

from offline.geometry.pipeline import TrackGeometry


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
    fig.savefig(output_path, dpi=150)
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
    fig.savefig(output_path, dpi=150)
    plt.close(fig)
