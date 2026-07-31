"""CLI: build_track.py --csv <path> --circuit <name> --out-dir <dir> [options]

runs the M1 ingest pipeline end to end and writes track.json + curvature.png (and
optionally boundaries.png) to --out-dir. On a hard-gate failure (loop doesn't close, or
normal-offset boundaries cross), prints the assertion message and exits 1 without writing
anything -- a failing run must never leave output that looks successful.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from offline.geometry.pipeline import build_track
from offline.validation.plots import plot_boundaries, plot_curvature


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, required=True, help="path to a TUMFTM-format CSV")
    parser.add_argument("--circuit", type=str, required=True, help="circuit name")
    parser.add_argument("--out-dir", type=Path, required=True, help="output directory")
    parser.add_argument("--spacing-m", type=float, default=1.0, help="arc-length resample spacing")
    parser.add_argument(
        "--gps-noise-std-m",
        type=float,
        default=0.1,
        help="assumed positional noise in raw points; drives the spline smoothing factor",
    )
    parser.add_argument("--loop-closure-tol-m", type=float, default=1e-3)
    parser.add_argument(
        "--plot-boundaries", action="store_true", help="also save a boundaries.png sanity plot"
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
            loop_closure_tol_m=args.loop_closure_tol_m,
        )
    except (AssertionError, ValueError) as exc:
        print(f"track build failed: {exc}", file=sys.stderr)
        return 1

    args.out_dir.mkdir(parents=True, exist_ok=True)

    track_json_path = args.out_dir / "track.json"
    track_json_path.write_text(json.dumps(track.to_json_dict(), indent=2))

    plot_curvature(track, args.out_dir / "curvature.png")
    if args.plot_boundaries:
        plot_boundaries(track, args.out_dir / "boundaries.png")

    print(
        f"{track.circuit_name}: {track.n_points} points, "
        f"loop length {track.loop_length_m:.1f} m -> {args.out_dir}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
