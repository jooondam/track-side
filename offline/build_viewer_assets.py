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
from scipy.spatial import cKDTree

from offline.elevation.profile import load_elevation_profile
from offline.geometry.pipeline import build_track
from offline.mincurv.line import build_mincurv_line
from offline.velocity.solver import solve_velocity_profile
from offline.velocity.vehicle import DEFAULT_GT3, GT3Vehicle


def _to_yup(x_m: np.ndarray, y_m: np.ndarray, z_m: np.ndarray) -> np.ndarray:
    """track frame (z up) to glTF frame (y up), matching offline/mesh/gltf.py's rotation."""
    return np.column_stack([x_m, z_m, -y_m])


def _terrain_grid(
    track, z_m: np.ndarray, n_cells: int = 140, margin_frac: float = 0.35
) -> dict:
    """IDW-interpolated landscape height grid around the circuit, in the Y-up frame's ground
    plane (grid axes are gltf x and z = -track_y; heights are gltf y).

    heights are exact near the track (nearest track point dominates the weighting) and relax
    toward the track's mean elevation with distance, with a distance-based blend so far-field
    terrain flattens out rather than extrapolating structure the data can't support.
    """
    gx = track.x_m
    gz = -track.y_m
    span_x = gx.max() - gx.min()
    span_z = gz.max() - gz.min()
    pad_x = span_x * margin_frac
    pad_z = span_z * margin_frac
    x0, x1 = gx.min() - pad_x, gx.max() + pad_x
    z0, z1 = gz.min() - pad_z, gz.max() + pad_z

    xs = np.linspace(x0, x1, n_cells)
    zs = np.linspace(z0, z1, n_cells)
    grid_x, grid_z = np.meshgrid(xs, zs)
    query = np.column_stack([grid_x.ravel(), grid_z.ravel()])

    tree = cKDTree(np.column_stack([gx, gz]))
    k = 12
    distances, indices = tree.query(query, k=k)
    weights = 1.0 / np.maximum(distances, 1.0) ** 2
    idw = np.sum(weights * z_m[indices], axis=1) / np.sum(weights, axis=1)

    # blend toward the mean with distance from the track: full data inside ~150 m,
    # fully relaxed beyond ~1200 m
    nearest = distances[:, 0]
    relax = np.clip((nearest - 150.0) / 1050.0, 0.0, 1.0)
    heights = (1.0 - relax) * idw + relax * float(np.mean(z_m))

    return {
        "schema_version": 1,
        "meta": {
            "circuit_name": track.circuit_name,
            "frame": "gltf Y-up; x0/z0 origin, heights are gltf y in metres",
            "n_cells": n_cells,
            "x0": round(float(x0), 2),
            "z0": round(float(z0), 2),
            "dx": round(float((x1 - x0) / (n_cells - 1)), 4),
            "dz": round(float((z1 - z0) / (n_cells - 1)), 4),
        },
        "heights": np.round(heights.reshape(n_cells, n_cells), 2).tolist(),
    }


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
    position_yup = _to_yup(line.x_m, line.y_m, z_line)

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

    (out_dir / "terrain.json").write_text(
        json.dumps(_terrain_grid(track, elevation.z_m), separators=(",", ":"))
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
