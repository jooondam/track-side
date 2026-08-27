"""every number in docs/VALIDATION.md, produced by one command.

    python -m offline.validation.report

The point is not the printing. A validation table nobody can regenerate is a screenshot of a
claim, and it rots silently: the committed NLP reference in `artifacts/` sat at pre-M8 physics
for four weeks after M8 landed, and nothing said so, because the numbers lived in a JSON file
that only a human re-ran. Everything here is computed from the vendored inputs at the moment it
is printed, so a stale row is a row that disagrees with the code.

The TypeScript side is not covered here and is not meant to be. Its numbers come from
`npx vitest run`, where the port is held to committed Python fixtures rather than described.
docs/VALIDATION.md says which command produces which table.
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import numpy as np

from offline.elevation.profile import build_elevation_profile, load_elevation_profile
from offline.elevation.registration import (
    apply_similarity_transform,
    register_via_icp,
)
from offline.geometry.pipeline import build_track
from offline.geometry.raceline import build_raceline_geometry
from offline.ingest.openf1 import load_cached_location_samples
from offline.landmarks.data import CIRCUITS
from offline.mincurv.line import build_mincurv_line
from offline.validation.checks import curvature_deviation, lateral_deviation
from offline.velocity.solver import solve_velocity_profile
from offline.velocity.vehicle import DEFAULT_GT3

ROOT = Path(__file__).resolve().parent.parent.parent
MU_GRID = (0.8, 1.0, 1.2, 1.4)

CIRCUIT_FILES = {
    "spa": {
        "name": "Spa",
        "csv": ROOT / "third_party" / "Spa.csv",
        "raceline": ROOT / "third_party" / "Spa_raceline.csv",
        "openf1": ROOT / "third_party" / "openf1" / "spa_2023_race_location.csv",
        "artifacts": ROOT / "artifacts" / "spa",
    },
    "monza": {
        "name": "Monza",
        "csv": ROOT / "third_party" / "Monza.csv",
        "raceline": ROOT / "third_party" / "Monza_raceline.csv",
        "openf1": ROOT / "third_party" / "openf1" / "monza_2023_race_location.csv",
        "artifacts": ROOT / "artifacts" / "monza",
    },
}


def _rule(title: str) -> None:
    print(f"\n## {title}\n")


def _geometry(circuit_id: str):
    files = CIRCUIT_FILES[circuit_id]
    track = build_track(files["csv"], circuit_name=files["name"], spacing_m=1.0)
    elevation = load_elevation_profile(files["artifacts"] / "elevation.json")
    line = build_mincurv_line(track, margin_m=1.0, spacing_m=1.0, elevation=elevation)
    return track, elevation, line


def lap_times(circuit_id: str, line) -> dict[float, float]:
    """the shipped decomposition: minimum-curvature path, then a velocity profile on it."""
    out = {}
    for mu in MU_GRID:
        vehicle = dataclasses.replace(DEFAULT_GT3, mu=mu)
        out[mu] = float(solve_velocity_profile(line, vehicle).lap_time_s)
    return out


def nlp_reference(circuit_id: str) -> dict[float, dict]:
    """the M4 minimum-time NLP, read from its committed sweep.

    Read rather than re-solved: IPOPT takes 30 s a circuit and this report is meant to be run
    often. `summary.json` carries every attempted mu including the ones that did not converge,
    which is the honest half of the comparison.
    """
    path = CIRCUIT_FILES[circuit_id]["artifacts"] / "summary.json"
    if not path.exists():
        return {}
    payload = json.loads(path.read_text())
    rows = payload["runs"] if isinstance(payload, dict) else payload
    return {row["mu"]: row for row in rows}


def m8_isolation(line) -> dict[str, float]:
    """grade and tyre load sensitivity, separated, at the reference grip.

    The two arrived in one commit, so which of them costs the lap time is not something the M8
    numbers answer on their own. Both off is not "the pre-M8 solver" exactly, since the axle
    split and the brake bias are still there, but it is the same road under a tyre whose grip
    does not care what is standing on it.
    """
    out = {}
    for grade_on, z in (("flat", np.zeros_like(line.z_m)), ("graded", line.z_m)):
        graded_line = dataclasses.replace(line, z_m=z)
        for k_on, k in (("k=0", 0.0), ("k=0.10", DEFAULT_GT3.tyre_load_sensitivity)):
            vehicle = dataclasses.replace(DEFAULT_GT3, mu=1.2, tyre_load_sensitivity=k)
            out[f"{grade_on}, {k_on}"] = float(
                solve_velocity_profile(graded_line, vehicle).lap_time_s
            )
    return out


def path_vs_tum(circuit_id: str, track, line) -> dict[str, dict[str, float]]:
    """the minimum-curvature line against TUMFTM's published raceline for the same track."""
    files = CIRCUIT_FILES[circuit_id]
    if not files["raceline"].exists():
        return {}
    tum = build_raceline_geometry(files["raceline"], circuit_name=files["name"])
    ours = np.column_stack([line.x_m, line.y_m])
    theirs = np.column_stack([tum.x_m, tum.y_m])
    return {
        "lateral": lateral_deviation(ours, theirs),
        "curvature": curvature_deviation(
            line.kappa_1pm, np.interp(
                np.linspace(0, 1, len(line.kappa_1pm)),
                np.linspace(0, 1, len(tum.kappa_1pm)),
                tum.kappa_1pm,
            )
        ),
        "length": {"ours_m": float(line.s_m[-1]), "tum_m": float(tum.s_m[-1])},
    }


def elevation_registration(circuit_id: str, track) -> dict[str, float]:
    """re-run the ICP fit that put OpenF1's arbitrary frame onto the track's metre frame."""
    files = CIRCUIT_FILES[circuit_id]
    samples = load_cached_location_samples(files["openf1"])
    lap_ids = np.unique(np.column_stack([samples.driver_number, samples.lap_number]), axis=0)
    best = None
    for driver, lap in lap_ids:
        mask = (samples.driver_number == driver) & (samples.lap_number == lap)
        if best is None or np.sum(mask) > np.sum(best):
            best = mask
    reg = register_via_icp(
        np.column_stack([samples.x_raw[best], samples.y_raw[best]]),
        np.column_stack([track.x_m, track.y_m]),
    )
    return {
        "scale": reg.scale,
        "rmse_m": reg.rmse_m,
        "mirrored": reg.mirrored,
        "iterations": reg.n_iterations,
        "n_samples": int(len(samples.x_raw)),
        "lap_samples": int(np.sum(best)),
    }


def elevation_shape(circuit_id: str, elevation) -> dict[str, float]:
    """the two claims the elevation profile is checked against in public."""
    z = np.asarray(elevation.z_m)
    s = np.asarray(elevation.s_m)
    out = {"range_m": float(z.max() - z.min())}
    if circuit_id == "spa":
        # **the climb, and how much of it survives the smoothing.** "Eau Rouge is a ~40 m climb"
        # is the claim this profile is checked against in public, and it is a claim about a
        # window nobody states. So state one: from the lowest point of the compression, found
        # between two *measured* corners rather than at a hand-picked arc length, and then 500 m
        # of road from there. The gradient is reported beside it because that is where the
        # 25 m binning shows up: a real profile is steeper than a low-passed one, and the
        # register (row 15) says so.
        corners = {c.name: c for c in CIRCUITS["spa"].corners}
        window = (s >= corners["La Source"].s_m) & (s <= corners["Les Combes"].turn_in_s_m)
        z_win, s_win = z[window], s[window]
        i_lo = int(np.argmin(z_win))
        s_lo, z_lo = float(s_win[i_lo]), float(z_win[i_lo])

        out["compression_s_m"] = s_lo
        for run in (300.0, 500.0, 650.0):
            out[f"rise_over_{int(run)}m"] = float(np.interp(s_lo + run, s, z)) - z_lo
        out["to_les_combes_m"] = float(np.interp(corners["Les Combes"].turn_in_s_m, s, z)) - z_lo

        # steepest sustained gradient over the climb, on a 50 m base
        climb = (s >= s_lo) & (s <= s_lo + 700)
        sc, zc = s[climb], z[climb]
        grades = (zc[50:] - zc[:-50]) / (sc[50:] - sc[:-50])
        j = int(np.argmax(grades))
        out["max_grade_frac"] = float(grades[j])
        out["max_grade_s_m"] = float(sc[j + 25])
    return out


def main() -> int:
    print("# track-side validation report")
    print("\nGenerated by `python -m offline.validation.report`. Every number below is computed")
    print("from the vendored inputs at the moment it is printed.")

    for circuit_id in ("spa", "monza"):
        name = CIRCUIT_FILES[circuit_id]["name"]
        track, elevation, line = _geometry(circuit_id)

        _rule(f"{name}: lap time, decomposition against the NLP reference")
        nlp = nlp_reference(circuit_id)
        ours = lap_times(circuit_id, line)
        print(f"{'mu':>5} {'mincurv+profile':>16} {'min-time NLP':>14} {'delta':>9} {'delta %':>8}")
        for mu in MU_GRID:
            row = nlp.get(mu)
            if row is None or row.get("status") != "ok":
                why = "did not converge" if row else "not solved"
                print(f"{mu:>5.2f} {ours[mu]:>16.2f} {why:>14} {'':>9} {'':>8}")
                continue
            ref = row["lap_time_s"]
            d = ours[mu] - ref
            print(f"{mu:>5.2f} {ours[mu]:>16.2f} {ref:>14.2f} {d:>9.2f} {100 * d / ref:>8.2f}")

        _rule(f"{name}: what M8 cost, grade and tyre load sensitivity separated (mu 1.20)")
        iso = m8_isolation(line)
        base = iso["flat, k=0"]
        for label, t in iso.items():
            print(f"{label:>16} {t:>9.2f} s {t - base:>+8.2f} s vs flat and load-insensitive")

        _rule(f"{name}: what the grade alone costs, across the grip slider")
        for mu in MU_GRID:
            vehicle = dataclasses.replace(DEFAULT_GT3, mu=mu)
            flat_line = dataclasses.replace(line, z_m=np.zeros_like(line.z_m))
            graded = float(solve_velocity_profile(line, vehicle).lap_time_s)
            flat = float(solve_velocity_profile(flat_line, vehicle).lap_time_s)
            print(f"{mu:>5.2f} graded {graded:>8.2f} s, flat {flat:>8.2f} s, "
                  f"grade costs {graded - flat:>+6.2f} s")

        _rule(f"{name}: the minimum-curvature line against TUMFTM's published raceline")
        cmp = path_vs_tum(circuit_id, track, line)
        if cmp:
            lat = cmp["lateral"]
            print(f"  lateral deviation: mean {lat['mean_m']:.2f} m, max {lat['max_m']:.2f} m")
            kap = cmp["curvature"]
            print(f"  curvature: rmse {kap['rmse']:.5f} 1/m, max abs {kap['max_abs_error']:.5f} 1/m")
            print(f"  loop length: ours {cmp['length']['ours_m']:.1f} m, "
                  f"TUM {cmp['length']['tum_m']:.1f} m")
        else:
            print("  no vendored raceline for this circuit")

        _rule(f"{name}: elevation")
        reg = elevation_registration(circuit_id, track)
        print(f"  OpenF1 registration: scale {reg['scale']:.6f}, RMSE {reg['rmse_m']:.2f} m, "
              f"mirrored {reg['mirrored']}, {reg['iterations']} ICP iterations")
        print(f"  samples: {reg['n_samples']} cached, {reg['lap_samples']} on the lap it fits to")
        shape = elevation_shape(circuit_id, elevation)
        print(f"  total range: {shape['range_m']:.1f} m")
        if "compression_s_m" in shape:
            print(f"  Eau Rouge compression bottoms at s={shape['compression_s_m']:.0f}; the "
                  f"climb from there is")
            for run in (300, 500, 650):
                print(f"    {shape[f'rise_over_{run}m']:5.1f} m over the next {run} m")
            print(f"    {shape['to_les_combes_m']:5.1f} m by Les Combes")
            print(f"  steepest 50 m gradient on the climb: "
                  f"{100 * shape['max_grade_frac']:.1f}% at s={shape['max_grade_s_m']:.0f}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
