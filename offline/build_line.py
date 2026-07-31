"""CLI: build_line.py --csv <path> --raceline-csv <path> --circuit <name> --out-dir <dir> [options]

runs the M3 minimum-curvature path solver end to end: M1 centerline -> QP path -> M2 velocity
solver on both our line and TUM's supplied raceline (same vehicle instance, so the comparison
isolates path shape from vehicle-model differences) -> lateral deviation and lap-time delta.
Writes line.json + line_comparison.png + lateral_offset.png to --out-dir. On a hard-gate
failure, prints the assertion message and exits 1 without writing anything.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

from offline.geometry.pipeline import build_track
from offline.geometry.raceline import build_raceline_geometry
from offline.mincurv.line import build_mincurv_line
from offline.validation.checks import (
    assert_closed_loop_velocity,
    assert_energy_balance,
    lateral_deviation,
)
from offline.validation.plots import plot_lateral_offset, plot_line_comparison
from offline.velocity.solver import solve_velocity_profile
from offline.velocity.vehicle import DEFAULT_GT3


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, required=True, help="path to a TUMFTM centerline CSV")
    parser.add_argument(
        "--raceline-csv", type=Path, required=True, help="path to TUM's reference raceline CSV"
    )
    parser.add_argument("--circuit", type=str, required=True, help="circuit name")
    parser.add_argument("--out-dir", type=Path, required=True, help="output directory")
    parser.add_argument("--spacing-m", type=float, default=1.0)
    parser.add_argument("--gps-noise-std-m", type=float, default=0.1)
    parser.add_argument("--loop-closure-tol-m", type=float, default=1e-3)
    parser.add_argument("--margin-m", type=float, default=1.0)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    try:
        track = build_track(
            csv_path=args.csv,
            circuit_name=args.circuit,
            spacing_m=args.spacing_m,
            gps_noise_std_m=args.gps_noise_std_m,
            loop_closure_tol_m=args.loop_closure_tol_m,
        )
        line = build_mincurv_line(
            track,
            margin_m=args.margin_m,
            spacing_m=args.spacing_m,
            loop_closure_tol_m=args.loop_closure_tol_m,
        )
        tum_raceline = build_raceline_geometry(
            csv_path=args.raceline_csv,
            circuit_name=args.circuit,
            spacing_m=args.spacing_m,
            gps_noise_std_m=args.gps_noise_std_m,
            loop_closure_tol_m=args.loop_closure_tol_m,
        )

        our_profile = solve_velocity_profile(line, DEFAULT_GT3)
        tum_profile = solve_velocity_profile(tum_raceline, DEFAULT_GT3)
        for profile in (our_profile, tum_profile):
            assert_closed_loop_velocity(profile.v_mps)
            assert_energy_balance(
                profile.v_mps,
                profile.ax_mps2,
                DEFAULT_GT3.ax_drag_mps2(profile.v_mps),
                DEFAULT_GT3.mass_kg,
                DEFAULT_GT3.power_w,
            )
    except (AssertionError, ValueError) as exc:
        print(f"minimum-curvature line build failed: {exc}", file=sys.stderr)
        return 1

    deviation = lateral_deviation(
        np.column_stack([line.x_m, line.y_m]),
        np.column_stack([tum_raceline.x_m, tum_raceline.y_m]),
    )
    lap_time_delta_s = our_profile.lap_time_s - tum_profile.lap_time_s

    args.out_dir.mkdir(parents=True, exist_ok=True)

    line_json = line.to_json_dict()
    line_json["comparison"] = {
        "reference": str(args.raceline_csv),
        "lateral_deviation_max_m": deviation["max_m"],
        "lateral_deviation_mean_m": deviation["mean_m"],
        "our_lap_time_s": our_profile.lap_time_s,
        "tum_lap_time_s": tum_profile.lap_time_s,
        "lap_time_delta_s": lap_time_delta_s,
    }
    (args.out_dir / "line.json").write_text(json.dumps(line_json, indent=2))

    plot_line_comparison(track, line, tum_raceline, args.out_dir / "line_comparison.png")
    plot_lateral_offset(line, args.out_dir / "lateral_offset.png")

    print(
        f"{line.circuit_name}: lateral deviation vs TUM max={deviation['max_m']:.2f} m, "
        f"mean={deviation['mean_m']:.2f} m; lap time ours={our_profile.lap_time_s:.2f} s, "
        f"TUM={tum_profile.lap_time_s:.2f} s, delta={lap_time_delta_s:+.2f} s -> {args.out_dir}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
