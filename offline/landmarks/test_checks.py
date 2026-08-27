"""tests for the landmark gates, including that the committed data passes them.

the gates matter more than usual here because this is the only hand-typed artifact in the
project: nothing downstream would notice a corner placed 400 m off, it would just put a label in
a field. Each test below fails the gate on purpose first, so the gate is shown to bite rather
than merely to exist.
"""

from __future__ import annotations

import dataclasses

import pytest

from offline.landmarks.build import landmarks_to_json_dict
from offline.landmarks.checks import (
    assert_boards_do_not_cross_previous_corner,
    assert_corner_ids_unique,
    assert_corners_match_geometry,
    assert_landmarks_on_track,
    assert_no_text_on_structures,
    assert_structure_offsets_clear_the_boundary,
)
from offline.landmarks.data import CircuitLandmarks, Corner, Structure

LOOP_M = 5000.0


def _landmarks(**overrides) -> CircuitLandmarks:
    base = dict(
        circuit_id="test",
        circuit_name="Test",
        corners=[
            Corner("t1", 1, "First", s_m=1000, turn_in_s_m=960),
            Corner("t2", 2, "Second", s_m=3000, turn_in_s_m=2950),
        ],
        structures=[Structure("g1", "gantry", s_m=1000)],
    )
    base.update(overrides)
    return CircuitLandmarks(**base)


class _FakeTrack:
    """minimal stand-in for TrackGeometry: the offset gate only reads s and the widths."""

    def __init__(self, half_width_m: float = 6.0):
        import numpy as np

        self.s_m = np.linspace(0.0, LOOP_M, 501)
        self.w_tr_left_m = np.full(501, half_width_m)
        self.w_tr_right_m = np.full(501, half_width_m)


def test_duplicate_corner_ids_are_rejected() -> None:
    bad = _landmarks(
        corners=[
            Corner("t1", 1, "First", s_m=1000, turn_in_s_m=960),
            Corner("t1", 2, "Second", s_m=3000, turn_in_s_m=2950),
        ]
    )
    with pytest.raises(AssertionError, match="duplicate corner id"):
        assert_corner_ids_unique(bad)


def test_arc_length_off_the_lap_is_rejected() -> None:
    # the classic mistake: a number typed for a circuit of a different length
    bad = _landmarks(corners=[Corner("t1", 1, "First", s_m=9000, turn_in_s_m=8960)])
    with pytest.raises(AssertionError, match="outside the"):
        assert_landmarks_on_track(bad, LOOP_M)


def test_turn_in_after_the_apex_is_rejected() -> None:
    bad = _landmarks(corners=[Corner("t1", 1, "First", s_m=1000, turn_in_s_m=1040)])
    with pytest.raises(AssertionError, match="not a corner entry"):
        assert_landmarks_on_track(bad, LOOP_M)


def test_unknown_structure_kind_is_rejected() -> None:
    # a kind with no generator would render as nothing at all, silently
    bad = _landmarks(structures=[Structure("x", "helipad", s_m=100)])
    with pytest.raises(AssertionError, match="has no generator"):
        assert_landmarks_on_track(bad, LOOP_M)


def test_world_placement_needs_a_polyline() -> None:
    bad = _landmarks(structures=[Structure("x", "banking_remnant", placement="world")])
    with pytest.raises(AssertionError, match="at least two points"):
        assert_landmarks_on_track(bad, LOOP_M)


def test_board_reaching_past_the_previous_corner_is_rejected() -> None:
    """the real case this caught: Monza's two Lesmos are 300 m apart.

    a 300 m board for the second one would stand before the first one's apex, where a driver
    reads it as the exit of the corner before.
    """
    bad = _landmarks(
        corners=[
            Corner("t1", 1, "Lesmo 1", s_m=1000, turn_in_s_m=960),
            Corner("t2", 2, "Lesmo 2", s_m=1300, turn_in_s_m=1265, board_distances_m=(300,)),
        ]
    )
    with pytest.raises(AssertionError, match="would sit"):
        assert_boards_do_not_cross_previous_corner(bad, LOOP_M)


def test_a_short_board_set_between_close_corners_is_accepted() -> None:
    good = _landmarks(
        corners=[
            Corner("t1", 1, "Lesmo 1", s_m=1000, turn_in_s_m=960),
            Corner("t2", 2, "Lesmo 2", s_m=1300, turn_in_s_m=1265, board_distances_m=(200, 100)),
        ]
    )
    assert_boards_do_not_cross_previous_corner(good, LOOP_M)


def test_structure_standing_on_the_road_is_rejected() -> None:
    bad = _landmarks(structures=[Structure("s", "grandstand", s_m=1000, offset_m=4.0)])
    with pytest.raises(AssertionError, match="inside the road edge"):
        assert_structure_offsets_clear_the_boundary(bad, _FakeTrack())


def test_overhead_structures_are_allowed_to_span_the_road() -> None:
    # gantries and bridges cross the track on purpose; they are overhead, not beside it
    spanning = _landmarks(
        structures=[
            Structure("g", "gantry", s_m=1000, offset_m=0.0),
            Structure("b", "bridge", s_m=2000, offset_m=0.0),
        ]
    )
    assert_structure_offsets_clear_the_boundary(spanning, _FakeTrack())


def test_no_field_could_carry_text_onto_a_structure() -> None:
    """the licensing rule (DESIGN_NOTES section 5), made mechanical.

    structures carry no text beyond turn numbers and board distances. this fails the moment a
    field is added that could hold a wordmark, which forces the review to happen at authoring
    time rather than after the asset ships.
    """
    assert_no_text_on_structures(_landmarks())

    @dataclasses.dataclass(frozen=True)
    class Sponsored(Structure):
        signage_text: str = "SOME SPONSOR"

    with pytest.raises(AssertionError, match="licensing review"):
        assert_no_text_on_structures(
            _landmarks(structures=[Sponsored("s", "grandstand", s_m=1000, offset_m=30.0)])
        )


def test_boards_are_derived_back_from_turn_in() -> None:
    payload = landmarks_to_json_dict(_landmarks(), LOOP_M)
    corner = payload["corners"][0]
    assert [b["s_m"] for b in corner["boards"]] == [660.0, 760.0, 860.0, 910.0]
    # measured from turn-in, not from the apex
    assert corner["boards"][-1]["s_m"] == corner["turn_in_s_m"] - 50.0


def test_boards_wrap_around_the_start_line() -> None:
    early = _landmarks(corners=[Corner("t1", 1, "Turn 1", s_m=120, turn_in_s_m=100)])
    payload = landmarks_to_json_dict(early, LOOP_M)
    # a 300 m board for a corner 100 m into the lap belongs near the end of the previous lap
    assert payload["corners"][0]["boards"][0]["s_m"] == pytest.approx(LOOP_M - 200.0)


def test_corners_are_written_in_arc_length_order() -> None:
    shuffled = _landmarks(
        corners=[
            Corner("t2", 2, "Second", s_m=3000, turn_in_s_m=2950),
            Corner("t1", 1, "First", s_m=1000, turn_in_s_m=960),
        ]
    )
    payload = landmarks_to_json_dict(shuffled, LOOP_M)
    assert [c["id"] for c in payload["corners"]] == ["t1", "t2"]


# ---- the corner-to-geometry gate ---------------------------------------------------------
#
# this one is here because its absence shipped: every Monza corner sat up to 340 m short of the
# corner it named, and every other gate in this file passed on that data.


def _road():
    """a lap whose corners are where _landmarks() says they are: apexes 1000 and 3000.

    triangular bends 45 m each side, so the 1/400 threshold is crossed 5.6 m up from the foot
    and the detected turn-in lands on 961 and 2961, within the gate's tolerance of the authored
    960 and 2950.
    """
    import numpy as np

    s = np.arange(int(LOOP_M) + 1, dtype=float)
    kappa = np.zeros(int(LOOP_M) + 1)
    for centre in (1000, 3000):
        for i in range(int(LOOP_M)):
            d = abs((i - centre + LOOP_M / 2) % LOOP_M - LOOP_M / 2)
            if d < 45:
                kappa[i] += 0.02 * (1.0 - d / 45)
    kappa[int(LOOP_M)] = kappa[0]
    return s, kappa


def test_committed_corner_positions_pass_against_their_own_road() -> None:
    s, kappa = _road()
    assert_corners_match_geometry(_landmarks(), s, kappa, LOOP_M)


def test_an_apex_that_is_not_on_a_corner_is_rejected() -> None:
    s, kappa = _road()
    strayed = _landmarks(
        corners=[
            Corner("t1", 1, "First", s_m=1150, turn_in_s_m=1110),
            Corner("t2", 2, "Second", s_m=3000, turn_in_s_m=2950),
        ]
    )
    with pytest.raises(AssertionError, match="nearest corner in the geometry"):
        assert_corners_match_geometry(strayed, s, kappa, LOOP_M)


def test_a_turn_in_that_is_not_where_the_road_bends_is_rejected() -> None:
    s, kappa = _road()
    early = _landmarks(
        corners=[
            Corner("t1", 1, "First", s_m=1000, turn_in_s_m=800),
            Corner("t2", 2, "Second", s_m=3000, turn_in_s_m=2950),
        ]
    )
    with pytest.raises(AssertionError, match="Every braking board hangs off this number"):
        assert_corners_match_geometry(early, s, kappa, LOOP_M)


def test_two_corners_cannot_claim_the_same_corner() -> None:
    s, kappa = _road()
    doubled = _landmarks(
        corners=[
            Corner("t1", 1, "First", s_m=1000, turn_in_s_m=960),
            Corner("t1b", 2, "Also First", s_m=1010, turn_in_s_m=965),
        ]
    )
    with pytest.raises(AssertionError, match="both claim the corner"):
        assert_corners_match_geometry(doubled, s, kappa, LOOP_M)


def test_a_road_with_no_corners_is_reported_rather_than_passed() -> None:
    import numpy as np

    s = np.arange(int(LOOP_M) + 1, dtype=float)
    with pytest.raises(AssertionError, match="no corners detected"):
        assert_corners_match_geometry(_landmarks(), s, np.zeros(int(LOOP_M) + 1), LOOP_M)
