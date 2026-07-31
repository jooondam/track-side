"""CLI: build_viewer_assets.py --csv <path> --circuit <name> --elevation <json> [options]

assembles everything the M6 browser viewer loads, so the frontend never parses offline
artifacts directly:

  public/<circuit>/track.glb     copied from --glb (the build_mesh.py output)
  public/<circuit>/line.json     racing line positions in the glTF Y-up frame with elevation
                                 draped on, plus s_m / kappa_1pm for the in-browser solver
  public/<circuit>/vehicle.json  GT3Vehicle's defaults -- physics constants keep exactly one
                                 source of truth (Python); the browser only ever varies mu
  src/solver/testdata/velocity_fixture.json
                                 solve_velocity_profile at several mu values on the same line,
                                 the cross-validation target for the TypeScript port's tests

the line's z comes from the elevation profile by fractional loop position (the line's refit
arc length differs slightly from the centerline's, same situation build_line_from_offsets
already handles for widths). Positions are converted to Y-up with the exact rotation
offline/mesh/gltf.py applies to the mesh, so the browser works in one frame with zero
coordinate logic in TS.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import shutil
import sys
from pathlib import Path

import numpy as np

from offline.elevation.profile import load_elevation_profile
from offline.geometry.pipeline import build_track
from offline.mincurv.line import build_mincurv_line
from offline.velocity.solver import solve_velocity_profile
from offline.velocity.vehicle import DEFAULT_GT3, GT3Vehicle


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, required=True, help="path to a TUMFTM centerline CSV")
    parser.add_argument("--circuit", type=str, required=True, help="circuit name")
    parser.add_argument(
        "--elevation", type=Path, required=True, help="elevation.json from build_elevation.py"
    )
    parser.add_argument("--glb", type=Path, required=True, help="track.glb from build_mesh.py")
    parser.add_argument("--public-dir", type=Path, default=Path("public"))
    parser.add_argument("--fixture-dir", type=Path, default=Path("src/solver/testdata"))
    parser.add_argument("--spacing-m", type=float, default=1.0)
    parser.add_argument("--gps-noise-std-m", type=float, default=0.1)
    parser.add_argument("--margin-m", type=float, default=1.0)
    parser.add_argument(
        "--fixture-mu-grid", type=str, default="0.8,1.2,1.4", help="mu values for the TS fixture"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    try:
        track = build_track(
            csv_path=args.csv,
            circuit_name=args.circuit,
            spacing_m=args.spacing_m,
            gps_noise_std_m=args.gps_noise_std_m,
        )
        line = build_mincurv_line(track, margin_m=args.margin_m, spacing_m=args.spacing_m)
        elevation = load_elevation_profile(args.elevation)
    except (AssertionError, ValueError) as exc:
        print(f"asset build failed: {exc}", file=sys.stderr)
        return 1

    # drape elevation onto the line by fractional loop position
    line_frac = line.s_m / line.loop_length_m
    track_frac = elevation.s_m / elevation.s_m[-1]
    z_line = np.interp(line_frac, track_frac, elevation.z_m, period=1.0)

    # glTF Y-up frame, matching offline/mesh/gltf.py's rotation exactly: (x, y, z) -> (x, z, -y)
    position_yup = np.column_stack([line.x_m, z_line, -line.y_m])

    out_dir = args.public_dir / args.circuit.lower()
    out_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(args.glb, out_dir / "track.glb")

    (out_dir / "line.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "meta": {
                    "circuit_name": line.circuit_name,
                    "method": line.method,
                    "loop_length_m": line.loop_length_m,
                    "n_points": line.n_points,
                    "frame": "gltf Y-up, metres; same rotation as track.glb",
                },
                "line": {
                    "position_yup": position_yup.round(4).tolist(),
                    "s_m": line.s_m.round(4).tolist(),
                    "kappa_1pm": line.kappa_1pm.tolist(),
                },
            },
            separators=(",", ":"),
        )
    )

    v = DEFAULT_GT3
    (out_dir / "vehicle.json").write_text(
        json.dumps(
            {
                "mass_kg": v.mass_kg,
                "mu": v.mu,
                "downforce_area_m2": v.downforce_area_m2,
                "drag_area_m2": v.drag_area_m2,
                "power_w": v.power_w,
                "air_density_kgpm3": v.air_density_kgpm3,
                "g_mps2": v.g_mps2,
                "v_floor_mps": v.v_floor_mps,
            },
            indent=2,
        )
    )

    try:
        mu_grid = [float(m) for m in args.fixture_mu_grid.split(",")]
    except ValueError:
        print(f"could not parse --fixture-mu-grid {args.fixture_mu_grid!r}", file=sys.stderr)
        return 1

    fixtures = []
    for mu in mu_grid:
        profile = solve_velocity_profile(line, dataclasses.replace(DEFAULT_GT3, mu=mu))
        fixtures.append(
            {
                "mu": mu,
                "lap_time_s": profile.lap_time_s,
                "v_mps": profile.v_mps.round(6).tolist(),
                "phase": profile.phase.tolist(),
            }
        )
        print(f"fixture mu={mu:g}: lap time {profile.lap_time_s:.2f} s")

    args.fixture_dir.mkdir(parents=True, exist_ok=True)
    (args.fixture_dir / f"velocity_fixture_{args.circuit.lower()}.json").write_text(
        json.dumps(
            {
                "meta": {
                    "circuit_name": line.circuit_name,
                    "generator": "offline/build_viewer_assets.py, offline/velocity/solver.py",
                    "note": "cross-validation target for src/solver/velocity.ts",
                },
                "s_m": line.s_m.round(4).tolist(),
                "kappa_1pm": line.kappa_1pm.tolist(),
                "cases": fixtures,
            },
            separators=(",", ":"),
        )
    )

    print(f"viewer assets -> {out_dir}, fixture -> {args.fixture_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
