"""CLI: build_elevation.py --csv <path> --circuit <name> --cache <path> --out-dir <dir> [options]

the M5 elevation deliverable: registers cached OpenF1 car-location samples onto the TUMFTM
metre frame (offline/elevation/registration.py), builds a robust relative z(s) profile
(offline/elevation/profile.py), gates it through assert_elevation_plausible against the
circuit's documented figures, and writes elevation.json + a two-panel validation plot.

if the cache CSV doesn't exist yet and the --fetch-* options are given, it is fetched once
from the OpenF1 API and written before proceeding -- the committed third_party/openf1/ cache
means this normally never runs. Everything after the cache is offline and deterministic.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

from offline.elevation.profile import build_elevation_profile
from offline.elevation.registration import apply_similarity_transform, register_via_icp
from offline.geometry.pipeline import build_track
from offline.ingest.openf1 import (
    download_location_samples,
    find_clean_lap_windows,
    find_session_key,
    load_cached_location_samples,
)
from offline.validation.checks import assert_elevation_plausible
from offline.validation.plots import plot_elevation_profile


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, required=True, help="path to a TUMFTM centerline CSV")
    parser.add_argument("--circuit", type=str, required=True, help="circuit name")
    parser.add_argument("--cache", type=Path, required=True, help="OpenF1 location cache CSV")
    parser.add_argument("--out-dir", type=Path, required=True, help="output directory")
    parser.add_argument("--spacing-m", type=float, default=1.0)
    parser.add_argument("--gps-noise-std-m", type=float, default=0.1)
    parser.add_argument("--bin-size-m", type=float, default=25.0)
    parser.add_argument("--z-noise-std-m", type=float, default=0.5)
    parser.add_argument(
        "--expected-max-rise-m",
        type=float,
        default=40.0,
        help="documented steepest climb for the validation gate (Spa: Eau Rouge ~40 m)",
    )
    parser.add_argument(
        "--expected-total-range-m",
        type=float,
        default=100.0,
        help="documented total elevation range for the validation gate (Spa: ~100 m)",
    )

    parser.add_argument("--fetch-circuit-short-name", type=str, default="Spa-Francorchamps")
    parser.add_argument("--fetch-session-name", type=str, default="Race")
    parser.add_argument("--fetch-year", type=int, default=2023)
    parser.add_argument("--fetch-drivers", type=str, default="1,44,16")
    parser.add_argument("--fetch-laps-per-driver", type=int, default=2)

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
    except (AssertionError, ValueError) as exc:
        print(f"track build failed: {exc}", file=sys.stderr)
        return 1

    if not args.cache.exists():
        print(f"cache {args.cache} missing; fetching from OpenF1 once", file=sys.stderr)
        try:
            session_key = find_session_key(
                args.fetch_circuit_short_name, args.fetch_session_name, args.fetch_year
            )
            drivers = [int(d) for d in args.fetch_drivers.split(",")]
            windows = find_clean_lap_windows(session_key, drivers, args.fetch_laps_per_driver)
            download_location_samples(session_key, windows, args.cache)
        except (ValueError, OSError) as exc:
            print(f"OpenF1 fetch failed: {exc}", file=sys.stderr)
            return 1

    samples = load_cached_location_samples(args.cache)

    # register on the single lap with the most samples: one clean continuous trace round the
    # loop is what the ICP correspondence search needs, and more samples pin it best.
    lap_ids = np.unique(np.column_stack([samples.driver_number, samples.lap_number]), axis=0)
    best_mask = None
    for driver, lap in lap_ids:
        mask = (samples.driver_number == driver) & (samples.lap_number == lap)
        if best_mask is None or np.sum(mask) > np.sum(best_mask):
            best_mask = mask

    source_xy = np.column_stack([samples.x_raw[best_mask], samples.y_raw[best_mask]])
    target_xy = np.column_stack([track.x_m, track.y_m])
    try:
        registration = register_via_icp(source_xy, target_xy)
    except ValueError as exc:
        print(f"registration failed: {exc}", file=sys.stderr)
        return 1
    print(
        f"registration: scale={registration.scale:.6f} mirrored={registration.mirrored} "
        f"rmse={registration.rmse_m:.2f} m ({registration.n_iterations} ICP iterations)"
    )

    all_xy = np.column_stack([samples.x_raw, samples.y_raw])
    if registration.mirrored:
        all_xy[:, 0] = -all_xy[:, 0]
    moved = apply_similarity_transform(
        all_xy, registration.scale, registration.rotation, registration.translation
    )
    z_metres = samples.z_raw * registration.scale

    try:
        profile = build_elevation_profile(
            track,
            moved[:, 0],
            moved[:, 1],
            z_metres,
            bin_size_m=args.bin_size_m,
            z_noise_std_m=args.z_noise_std_m,
        )
        assert_elevation_plausible(
            profile.z_m,
            profile.s_m,
            expected_max_rise_m=args.expected_max_rise_m,
            expected_total_range_m=args.expected_total_range_m,
        )
    except (AssertionError, ValueError) as exc:
        print(f"elevation profile failed validation: {exc}", file=sys.stderr)
        return 1

    print(
        f"elevation: total range {profile.total_range_m:.1f} m from "
        f"{profile.n_samples_used} samples ({profile.n_samples_rejected} rejected)"
    )

    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "elevation.json").write_text(json.dumps(profile.to_json_dict(), indent=2))
    plot_elevation_profile(track, profile, args.out_dir / "elevation.png")

    return 0


if __name__ == "__main__":
    sys.exit(main())
