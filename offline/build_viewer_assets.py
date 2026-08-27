"""CLI: build_viewer_assets.py --csv <path> --circuit <name> --elevation <json> [options]

assembles everything the M6 browser viewer loads, so the frontend never parses offline
artifacts directly:

  public/<circuit>/track.glb        copied from --glb (the build_mesh.py output)
  public/<circuit>/line.json        racing line positions in the glTF Y-up frame with
                                    elevation draped on, plus s_m / kappa_1pm for the
                                    in-browser solver
  public/<circuit>/track_lines.json boundary polylines (the accurate road edges, straight from
                                    TrackGeometry's validated normal offsets), centerline
                                    positions + curvature (centerline dashes, kerb placement)
  public/<circuit>/terrain.json     landscape height grid around the circuit: inverse-distance
                                    weighted interpolation of the track's own registered
                                    elevation -- exact at the track, relaxing toward the local
                                    mean farther out; real data where it exists, honest
                                    smoothing where it doesn't
  public/<circuit>/vehicle.json     GT3Vehicle's defaults -- physics constants keep exactly one
                                    source of truth (Python); the browser only ever varies mu
  src/solver/testdata/velocity_fixture_<circuit>.json
                                    solve_velocity_profile at several mu values on the same
                                    line, the cross-validation target for the TS port's tests

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
from offline.landmarks.build import landmarks_to_json_dict
from offline.landmarks.checks import run_all_landmark_checks
from offline.landmarks.data import CIRCUITS
from offline.mesh.terrain import build_terrain_grid
from offline.mincurv.line import build_mincurv_line
from offline.velocity.solver import solve_velocity_profile, vehicle_to_json_dict
from offline.velocity.vehicle import CAP_ITERS, DEFAULT_GT3, LOAD_TRANSFER_ITERS


def _to_yup(x_m: np.ndarray, y_m: np.ndarray, z_m: np.ndarray) -> np.ndarray:
    """track frame (z up) to glTF frame (y up), matching offline/mesh/gltf.py's rotation."""
    return np.column_stack([x_m, z_m, -y_m])


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
        elevation = load_elevation_profile(args.elevation)
        # the drape lives inside build_line_from_offsets since M8, so the z the solver runs
        # its grade on and the z the viewer draws are the same array by construction
        line = build_mincurv_line(
            track, margin_m=args.margin_m, spacing_m=args.spacing_m, elevation=elevation
        )
        # landmarks are the one hand-typed artifact here, so they are gated against the
        # geometry that was just generated rather than trusted
        landmarks = CIRCUITS.get(args.circuit.lower())
        if landmarks is None:
            raise ValueError(
                f"no landmark data for circuit {args.circuit!r}; add it to "
                f"offline/landmarks/data.py"
            )
        run_all_landmark_checks(landmarks, track, line)
    except (AssertionError, ValueError) as exc:
        print(f"asset build failed: {exc}", file=sys.stderr)
        return 1

    # glTF Y-up frame, matching offline/mesh/gltf.py's rotation exactly: (x, y, z) -> (x, z, -y)
    position_yup = _to_yup(line.x_m, line.y_m, line.z_m).round(4)

    # the geometry the viewer actually solves on, which is the rounded geometry this script
    # writes, not the full-precision line it holds in memory. the viewer reads z back out of
    # position_yup, so the fixture takes its z from that same array.
    #
    # this matters because kappa_v is a second derivative of z: 1e-4 m of rounding is ~1e-7 on
    # the grade and utterly invisible in v(s), but it lands as ~80 N on the axle loads. solving
    # the fixture from the full-precision line would bake that difference into the expected
    # values and force the cross-language test to widen past the point where it could still
    # catch a real transfer error.
    shipped = dataclasses.replace(
        line, s_m=line.s_m.round(4), z_m=np.ascontiguousarray(position_yup[:, 1])
    )

    out_dir = args.public_dir / args.circuit.lower()
    out_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(args.glb, out_dir / "track.glb")

    # boundary/centerline polylines share the track grid, so elevation attaches directly
    (out_dir / "track_lines.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "meta": {
                    "circuit_name": track.circuit_name,
                    "loop_length_m": track.loop_length_m,
                    "n_points": track.n_points,
                    "frame": "gltf Y-up, metres; same rotation as track.glb",
                },
                "lines": {
                    "boundary_left_yup": np.round(
                        _to_yup(track.boundary_left_x_m, track.boundary_left_y_m, elevation.z_m), 4
                    ).tolist(),
                    "boundary_right_yup": np.round(
                        _to_yup(track.boundary_right_x_m, track.boundary_right_y_m, elevation.z_m),
                        4,
                    ).tolist(),
                    "centerline_yup": np.round(
                        _to_yup(track.x_m, track.y_m, elevation.z_m), 4
                    ).tolist(),
                    "centerline_s_m": track.s_m.round(4).tolist(),
                    "centerline_kappa_1pm": track.kappa_1pm.tolist(),
                },
            },
            separators=(",", ":"),
        )
    )

    # the identical grid build_mesh.py tied the apron to, so the roadside meets the landscape
    (out_dir / "terrain.json").write_text(
        json.dumps(build_terrain_grid(track, elevation.z_m).to_json_dict(), separators=(",", ":"))
    )

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
                    "position_yup": position_yup.tolist(),
                    "s_m": shipped.s_m.tolist(),
                    "kappa_1pm": shipped.kappa_1pm.tolist(),
                },
            },
            separators=(",", ":"),
        )
    )

    (out_dir / "landmarks.json").write_text(
        json.dumps(
            landmarks_to_json_dict(landmarks, line.loop_length_m), separators=(",", ":")
        )
    )

    (out_dir / "vehicle.json").write_text(
        json.dumps(vehicle_to_json_dict(DEFAULT_GT3), indent=2)
    )

    try:
        mu_grid = [float(m) for m in args.fixture_mu_grid.split(",")]
    except ValueError:
        print(f"could not parse --fixture-mu-grid {args.fixture_mu_grid!r}", file=sys.stderr)
        return 1

    fixtures = []
    for mu in mu_grid:
        profile = solve_velocity_profile(shipped, dataclasses.replace(DEFAULT_GT3, mu=mu))
        fixtures.append(
            {
                "mu": mu,
                "lap_time_s": profile.lap_time_s,
                "v_mps": profile.v_mps.round(6).tolist(),
                "phase": profile.phase.tolist(),
                # axle loads validate the M8 load model directly. without them the TS port is
                # only checked through v(s), where a transfer sign error that happens to
                # cancel inside the composed budget would pass unnoticed.
                "fz_front_n": profile.fz_front_n.round(1).tolist(),
                "fz_rear_n": profile.fz_rear_n.round(1).tolist(),
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
                    # the two fixed-point counts are part of the model, so the TS port has to
                    # use the same values. velocity.test.ts asserts its constants match these.
                    "load_transfer_iters": LOAD_TRANSFER_ITERS,
                    "cap_iters": CAP_ITERS,
                },
                # byte-identical to what line.json ships, and what the cases below were solved
                # from, so any residual difference the TS port shows is the port and nothing else
                "s_m": shipped.s_m.tolist(),
                "z_m": shipped.z_m.tolist(),
                "kappa_1pm": shipped.kappa_1pm.tolist(),
                "cases": fixtures,
            },
            separators=(",", ":"),
        )
    )

    print(f"viewer assets -> {out_dir}, fixture -> {args.fixture_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
