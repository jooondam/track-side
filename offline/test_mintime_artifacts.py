"""the committed minimum-time sweep, checked for staleness rather than re-solved.

This exists because of a specific failure. M8 put grade, load transfer and tyre load sensitivity
into the sequential solver, the TypeScript port *and* the NLP, and the NLP's committed sweep in
`artifacts/` was never re-run. For four weeks it sat at pre-M8 physics while docs/VALIDATION.md's
whole first table compares the shipped decomposition against it. A bare list of lap times cannot
be stale-checked against anything, so `build_mintime.py` now records what it solved with, and
this asserts that record still describes the project.

Re-solving here would cost 30 s a circuit under IPOPT and would not catch the bug: a fresh solve
is never stale. The thing worth asserting is that the *committed* one is not.
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import pytest

from offline.velocity.vehicle import DEFAULT_GT3

ROOT = Path(__file__).resolve().parent.parent
CIRCUIT_IDS = ["spa", "monza"]


def _summary(circuit_id: str) -> dict:
    return json.loads((ROOT / "artifacts" / circuit_id / "summary.json").read_text())


@pytest.mark.parametrize("circuit_id", CIRCUIT_IDS)
def test_the_sweep_records_what_it_was_solved_with(circuit_id) -> None:
    meta = _summary(circuit_id)["meta"]
    assert meta["circuit_name"].lower() == circuit_id
    assert Path(meta["source"]).name.lower().startswith(circuit_id)


@pytest.mark.parametrize("circuit_id", CIRCUIT_IDS)
def test_the_reference_ran_the_circuit_with_its_elevation(circuit_id) -> None:
    """a reference solved flat is a reference for physics the shipped solver does not run."""
    meta = _summary(circuit_id)["meta"]
    assert meta["elevation"] is not None, (
        f"{circuit_id}: the committed NLP sweep was solved on a flat circuit, so the lap times "
        f"in docs/VALIDATION.md compare two different sets of physics. Re-run build_mintime.py "
        f"with --elevation"
    )
    assert Path(meta["elevation"]).name == "elevation.json"


@pytest.mark.parametrize("circuit_id", CIRCUIT_IDS)
def test_the_reference_ran_the_vehicle_the_project_ships(circuit_id) -> None:
    """every field except mu, which the sweep varies on purpose.

    Compared field by field rather than as a whole dict, because `drive_axle` is a string and
    pytest.approx cannot walk a mixed one. A missing field is a failure too: a vehicle gaining a
    parameter the reference never saw is the same staleness in a new shape.
    """
    recorded = _summary(circuit_id)["meta"]["vehicle"]
    shipped = dataclasses.asdict(DEFAULT_GT3)
    shipped.pop("mu", None)
    assert set(recorded) == set(shipped)
    for field, value in shipped.items():
        if isinstance(value, float):
            assert recorded[field] == pytest.approx(value), field
        else:
            assert recorded[field] == value, field


@pytest.mark.parametrize("circuit_id", CIRCUIT_IDS)
def test_every_attempted_mu_is_reported_including_the_failures(circuit_id) -> None:
    """a sweep that quietly dropped a non-converged mu would read as full coverage."""
    runs = _summary(circuit_id)["runs"]
    assert [r["mu"] for r in runs] == sorted(r["mu"] for r in runs)
    for row in runs:
        assert row["status"] in ("ok", "failed")
        if row["status"] == "ok":
            assert row["lap_time_s"] > 0
            assert row["ipopt_status"] == "Solve_Succeeded"
        else:
            assert row["error"]


@pytest.mark.parametrize("circuit_id", CIRCUIT_IDS)
def test_lap_time_falls_as_grip_rises(circuit_id) -> None:
    converged = [r for r in _summary(circuit_id)["runs"] if r["status"] == "ok"]
    times = [r["lap_time_s"] for r in sorted(converged, key=lambda r: r["mu"])]
    assert times == sorted(times, reverse=True)
