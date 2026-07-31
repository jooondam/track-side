"""CLI: build_velocity.py --raceline-csv <path> --circuit <name> --out-dir <dir> [options]

runs the M2 velocity-profile pipeline end to end on TUM's supplied raceline and writes
velocity.json + velocity.png + speed_map.png to --out-dir. On a hard-gate failure (loop
doesn't close, or the composed accel budget implies more power than the engine can deliver),
prints the assertion message and exits 1 without writing anything.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from offline.geometry.raceline import build_raceline_geometry
from offline.validation.checks import assert_closed_loop_velocity, assert_energy_balance
from offline.validation.plots import plot_speed_map, plot_velocity
from offline.velocity.solver import solve_velocity_profile
from offline.velocity.vehicle import GT3Vehicle


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raceline-csv", type=Path, required=True, help="path to a TUMFTM-format raceline CSV")
    parser.add_argument("--circuit", type=str, required=True, help="circuit name")
    parser.add_argument("--out-dir", type=Path, required=True, help="output directory")
    parser.add_argument("--spacing-m", type=float, default=1.0)
    parser.add_argument("--gps-noise-std-m", type=float, default=0.1)
    parser.add_argument("--loop-closure-tol-m", type=float, default=1e-3)

    parser.add_argument("--mass-kg", type=float, default=GT3Vehicle.mass_kg)
    parser.add_argument("--mu", type=float, default=GT3Vehicle.mu)
    parser.add_argument("--downforce-area-m2", type=float, default=GT3Vehicle.downforce_area_m2)
    parser.add_argument("--drag-area-m2", type=float, default=GT3Vehicle.drag_area_m2)
    parser.add_argument("--power-w", type=float, default=GT3Vehicle.power_w)
    parser.add_argument("--air-density-kgpm3", type=float, default=GT3Vehicle.air_density_kgpm3)

    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    vehicle = GT3Vehicle(
        mass_kg=args.mass_kg,
        mu=args.mu,
        downforce_area_m2=args.downforce_area_m2,
        drag_area_m2=args.drag_area_m2,
        power_w=args.power_w,
        air_density_kgpm3=args.air_density_kgpm3,
    )

    try:
        geometry = build_raceline_geometry(
            csv_path=args.raceline_csv,
            circuit_name=args.circuit,
            spacing_m=args.spacing_m,
            gps_noise_std_m=args.gps_noise_std_m,
            loop_closure_tol_m=args.loop_closure_tol_m,
        )
        profile = solve_velocity_profile(geometry, vehicle)

        assert_closed_loop_velocity(profile.v_mps)
        assert_energy_balance(
            profile.v_mps,
            profile.ax_mps2,
            vehicle.ax_drag_mps2(profile.v_mps),
            vehicle.mass_kg,
            vehicle.power_w,
        )
    except (AssertionError, ValueError) as exc:
        print(f"velocity profile build failed: {exc}", file=sys.stderr)
        return 1

    args.out_dir.mkdir(parents=True, exist_ok=True)

    velocity_json_path = args.out_dir / "velocity.json"
    velocity_json_path.write_text(json.dumps(profile.to_json_dict(), indent=2))

    plot_velocity(profile, args.out_dir / "velocity.png")
    plot_speed_map(profile, args.out_dir / "speed_map.png")

    print(
        f"{profile.circuit_name}: lap time {profile.lap_time_s:.2f} s, "
        f"top speed {profile.v_mps.max() * 3.6:.1f} km/h -> {args.out_dir}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
