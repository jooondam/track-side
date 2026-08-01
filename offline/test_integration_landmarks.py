"""the committed landmark data, gated against the real generated geometry of both circuits.

test_checks.py proves the gates bite on synthetic data. This proves the data that actually ships
passes them, on the geometry that actually generates the arc lengths, which is the pairing that
makes "hand-placed estimates" a documented limitation rather than an unverified claim.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from offline.elevation.profile import load_elevation_profile
from offline.geometry.pipeline import build_track
from offline.landmarks.build import landmarks_to_json_dict
from offline.landmarks.checks import run_all_landmark_checks
from offline.landmarks.data import CIRCUITS
from offline.mincurv.line import build_mincurv_line

ROOT = Path(__file__).resolve().parent.parent
CIRCUIT_IDS = ["spa", "monza"]


@pytest.fixture(scope="module")
def geometry():
    built = {}
    for circuit_id in CIRCUIT_IDS:
        name = circuit_id.capitalize()
        track = build_track(
            ROOT / "third_party" / f"{name}.csv",
            circuit_name=name,
            spacing_m=1.0,
            gps_noise_std_m=0.1,
        )
        elevation = load_elevation_profile(ROOT / "artifacts" / circuit_id / "elevation.json")
        line = build_mincurv_line(track, margin_m=1.0, spacing_m=1.0, elevation=elevation)
        built[circuit_id] = (track, line)
    return built


@pytest.mark.parametrize("circuit_id", CIRCUIT_IDS)
def test_committed_landmarks_pass_every_gate(geometry, circuit_id) -> None:
    track, line = geometry[circuit_id]
    run_all_landmark_checks(CIRCUITS[circuit_id], track, line.loop_length_m)


@pytest.mark.parametrize("circuit_id", CIRCUIT_IDS)
def test_every_corner_has_a_reachable_position_on_the_line(geometry, circuit_id) -> None:
    _, line = geometry[circuit_id]
    for corner in CIRCUITS[circuit_id].corners:
        assert 0.0 <= corner.s_m < line.loop_length_m


@pytest.mark.parametrize("circuit_id", CIRCUIT_IDS)
def test_shipped_json_matches_a_fresh_build(geometry, circuit_id) -> None:
    """the committed artifact is in sync with the data and the current geometry.

    landmarks.json is written by build_viewer_assets.py, so it can fall behind data.py the same
    way any generated file can. this is the check that notices.
    """
    _, line = geometry[circuit_id]
    shipped = json.loads((ROOT / "public" / circuit_id / "landmarks.json").read_text())
    assert shipped == landmarks_to_json_dict(CIRCUITS[circuit_id], line.loop_length_m)


@pytest.mark.parametrize("circuit_id", CIRCUIT_IDS)
def test_boards_land_where_a_driver_would_read_them(geometry, circuit_id) -> None:
    _, line = geometry[circuit_id]
    payload = landmarks_to_json_dict(CIRCUITS[circuit_id], line.loop_length_m)

    for corner in payload["corners"]:
        for board in corner["boards"]:
            assert 0.0 <= board["s_m"] < line.loop_length_m
            # each board sits its own stated distance before turn-in, wrap included
            gap = (corner["turn_in_s_m"] - board["s_m"]) % line.loop_length_m
            assert gap == pytest.approx(board["distance_m"], abs=0.01)
        # boards run in descending distance, so they are encountered in order on track
        distances = [b["distance_m"] for b in corner["boards"]]
        assert distances == sorted(distances, reverse=True)


def test_the_flat_out_corners_carry_no_boards() -> None:
    # Eau Rouge, Raidillon and Blanchimont are taken flat by a GT3 in the dry, so a braking
    # board there would be inventing a braking point the car does not have
    spa = {corner.id: corner for corner in CIRCUITS["spa"].corners}
    for corner_id in ("t2", "t3", "t14"):
        assert spa[corner_id].board_distances_m == ()
