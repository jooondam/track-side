"""CLI: build_mintime.py --csv <path> --circuit <name> --out-dir <dir> [options]

runs the M4 minimum-time NLP over a grid of grip coefficients (mu), the offline reference
docs/DESIGN_NOTES.md's Option C decision calls for. The runtime grip-weighted blend (later,
TS milestone) gets measured against this. Writes one mintime_mu_<value>.json per successfully
converged mu, a summary.json covering every attempted mu (including failures), and two plots.

unlike build_line.py/build_velocity.py, a single mu failing to converge does not abort the
whole run: the sweep's purpose is partly to characterize where the NLP breaks down, so
failures are caught, reported to stderr, and skipped while the rest of the grid proceeds.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import sys
from pathlib import Path

from offline.elevation.profile import load_elevation_profile
from offline.geometry.pipeline import build_track
from offline.reference.mintime import solve_mintime
from offline.validation.plots import plot_lap_time_vs_mu, plot_mintime_line
from offline.velocity.vehicle import GT3Vehicle


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, required=True, help="path to a TUMFTM centerline CSV")
    parser.add_argument("--circuit", type=str, required=True, help="circuit name")
    parser.add_argument("--out-dir", type=Path, required=True, help="output directory")
    parser.add_argument(
        "--elevation",
        type=Path,
        default=None,
        help=(
            "elevation.json from build_elevation.py. Without it the NLP runs the circuit flat, "
            "which makes it a reference for physics the shipped solver does not run"
        ),
    )
    parser.add_argument("--spacing-m", type=float, default=1.0)
    parser.add_argument("--gps-noise-std-m", type=float, default=0.1)
    parser.add_argument("--loop-closure-tol-m", type=float, default=1e-3)
    parser.add_argument("--margin-m", type=float, default=1.0)
    parser.add_argument(
        "--qp-spacing-m",
        type=float,
        default=15.0,
        help=(
            "coarse NLP grid spacing; 15m is what converges reliably on real, large tracks "
            "like Monza (~1150 points at 5m stresses IPOPT's scaling on the wide "
            "corner-to-straight speed range). Small/synthetic tracks can go finer."
        ),
    )
    parser.add_argument(
        "--mu-grid",
        type=str,
        default="0.8,1.0,1.2,1.4",
        help="comma-separated grip coefficients to sweep",
    )

    parser.add_argument("--mass-kg", type=float, default=GT3Vehicle.mass_kg)
    parser.add_argument("--downforce-area-m2", type=float, default=GT3Vehicle.downforce_area_m2)
    parser.add_argument("--drag-area-m2", type=float, default=GT3Vehicle.drag_area_m2)
    parser.add_argument("--power-w", type=float, default=GT3Vehicle.power_w)
    parser.add_argument("--air-density-kgpm3", type=float, default=GT3Vehicle.air_density_kgpm3)

    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    base_vehicle = GT3Vehicle(
        mass_kg=args.mass_kg,
        downforce_area_m2=args.downforce_area_m2,
        drag_area_m2=args.drag_area_m2,
        power_w=args.power_w,
        air_density_kgpm3=args.air_density_kgpm3,
    )

    try:
        mu_grid = [float(v) for v in args.mu_grid.split(",")]
    except ValueError:
        print(f"could not parse --mu-grid {args.mu_grid!r} as comma-separated floats", file=sys.stderr)
        return 1

    # **the reference has to run the same physics as the thing it is a reference for.** Before
    # this was wired the NLP solved every circuit flat while the sequential solver graded on real
    # z, so the two lap times differed by the grade as well as by the method, and the comparison
    # measured nothing. M8 put the load transfer and the tyre load sensitivity into both; this is
    # the last channel that was only in one.
    elevation = None
    if args.elevation is not None:
        try:
            elevation = load_elevation_profile(args.elevation)
        except (OSError, ValueError, KeyError) as exc:
            print(f"could not read {args.elevation}: {exc}", file=sys.stderr)
            return 1

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

    summary_rows = []
    solutions = {}
    for mu in mu_grid:
        vehicle = dataclasses.replace(base_vehicle, mu=mu)
        try:
            solution = solve_mintime(
                track,
                vehicle,
                margin_m=args.margin_m,
                qp_spacing_m=args.qp_spacing_m,
                elevation=elevation,
            )
        except (AssertionError, ValueError, RuntimeError) as exc:
            print(f"mu={mu}: minimum-time solve failed: {exc}", file=sys.stderr)
            summary_rows.append({"mu": mu, "status": "failed", "error": str(exc)})
            continue

        solutions[mu] = solution
        (args.out_dir / f"mintime_mu_{mu:g}.json").write_text(
            json.dumps(solution.to_json_dict(), indent=2)
        )
        summary_rows.append(
            {
                "mu": mu,
                "status": "ok",
                "lap_time_s": solution.lap_time_s,
                "solve_time_s": solution.solve_time_s,
                "ipopt_status": solution.ipopt_status,
                "n_iterations": solution.n_iterations,
            }
        )
        print(
            f"mu={mu}: lap time {solution.lap_time_s:.2f} s "
            f"(solved in {solution.solve_time_s:.1f} s, {solution.n_iterations} iterations)"
        )

    # **what the sweep was solved with, beside what it produced.** The committed sweep sat at
    # pre-M8 physics for four weeks after M8 landed and nothing said so, because a bare list of
    # lap times cannot be stale-checked against anything. This block can:
    # test_mintime_artifacts.py asserts the shipped sweep was solved with elevation and with the
    # vehicle the rest of the project ships.
    summary = {
        "schema_version": 1,
        "meta": {
            "circuit_name": args.circuit,
            "source": str(args.csv),
            "elevation": str(args.elevation) if args.elevation is not None else None,
            "margin_m": args.margin_m,
            "qp_spacing_m": args.qp_spacing_m,
            "vehicle": dataclasses.asdict(dataclasses.replace(base_vehicle, mu=float("nan"))),
        },
        "runs": summary_rows,
    }
    summary["meta"]["vehicle"].pop("mu", None)
    (args.out_dir / "summary.json").write_text(json.dumps(summary, indent=2))

    if not solutions:
        print("every mu in the grid failed to converge; no plots written", file=sys.stderr)
        return 1

    ok_mus = sorted(solutions)
    plot_lap_time_vs_mu(
        [m for m in ok_mus],
        [solutions[m].lap_time_s for m in ok_mus],
        args.out_dir / "lap_time_vs_mu.png",
    )
    representative_mu = min(ok_mus, key=lambda m: abs(m - base_vehicle.mu))
    plot_mintime_line(track, solutions[representative_mu], args.out_dir / "mintime_line.png")

    return 0


if __name__ == "__main__":
    sys.exit(main())
