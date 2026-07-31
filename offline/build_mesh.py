"""CLI: build_mesh.py --csv <path> --circuit <name> --elevation <json> --out-dir <dir>

the M5 mesh deliverable: triangulates the track surface ribbon (offline/mesh/ribbon.py) from
the M1 boundaries plus the elevation.json artifact build_elevation.py produced, and writes a
self-contained glTF binary (track.glb) ready for the M6 react-three-fiber viewer. Composes on
the committed elevation artifact rather than re-running registration -- rebuild elevation.json
first if the track input changes.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from offline.elevation.profile import load_elevation_profile
from offline.geometry.pipeline import build_track
from offline.mesh.gltf import write_glb
from offline.mesh.ribbon import build_ribbon_mesh


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, required=True, help="path to a TUMFTM centerline CSV")
    parser.add_argument("--circuit", type=str, required=True, help="circuit name")
    parser.add_argument(
        "--elevation", type=Path, required=True, help="elevation.json from build_elevation.py"
    )
    parser.add_argument("--out-dir", type=Path, required=True, help="output directory")
    parser.add_argument("--spacing-m", type=float, default=1.0)
    parser.add_argument("--gps-noise-std-m", type=float, default=0.1)
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
        mesh = build_ribbon_mesh(track, elevation)
    except (AssertionError, ValueError) as exc:
        print(f"mesh build failed: {exc}", file=sys.stderr)
        return 1

    args.out_dir.mkdir(parents=True, exist_ok=True)
    output_path = args.out_dir / "track.glb"
    write_glb(mesh, output_path)

    print(
        f"{mesh.circuit_name}: {mesh.n_cross_sections} cross-sections, "
        f"{len(mesh.vertices)} vertices, {len(mesh.triangles)} triangles -> {output_path} "
        f"({output_path.stat().st_size / 1024:.0f} KiB)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
