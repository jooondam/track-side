"""tests for corner detection on geometry whose corners are known by construction.

The detector is what decides where a corner is, and it is now the only thing standing between a
hand-typed arc length and a braking board in the wrong field, so it is tested on laps built here
rather than only on the two circuits that ship.
"""

from __future__ import annotations

import numpy as np

from offline.landmarks.geometry import (
    CORNER_KAPPA_THRESHOLD_1PM,
    detect_corner_spans,
    nearest_span,
)

LOOP_M = 4000


def _lap(bends: list[tuple[float, float, float]]) -> tuple[np.ndarray, np.ndarray]:
    """a 4 km lap at 1 m spacing, straight except for triangular bends.

    each bend is (centre_s, half_width_m, peak_kappa). triangular rather than square so the apex
    is a single point the detector has to find, and rather than a raised cosine so the threshold
    crossing is a number this file can predict on paper.
    """
    s = np.arange(LOOP_M + 1, dtype=float)
    kappa = np.zeros(LOOP_M + 1)
    for centre, half_width, peak in bends:
        for i in range(LOOP_M):
            d = abs((i - centre + LOOP_M / 2) % LOOP_M - LOOP_M / 2)
            if d < half_width:
                kappa[i] += peak * (1.0 - d / half_width)
    kappa[LOOP_M] = kappa[0]
    return s, kappa


def test_a_single_bend_is_one_corner_apexing_at_its_tightest_point() -> None:
    s, kappa = _lap([(1000, 45, 0.02)])
    spans = detect_corner_spans(s, kappa)
    assert len(spans) == 1
    assert spans[0].apex_s_m == 1000
    # the triangle crosses 1/400 at 45 * (0.0025 / 0.02) = 5.6 m from its foot
    assert spans[0].start_s_m == 961
    assert spans[0].peak_kappa_1pm < 0.02  # the boxcar takes the tip off, as it should


def test_a_bend_too_gentle_to_corner_for_is_not_a_corner() -> None:
    # a 1000 m radius, well under the 400 m threshold in curvature terms
    s, kappa = _lap([(1000, 45, 1.0 / 1000.0)])
    assert detect_corner_spans(s, kappa) == []
    # and the threshold is where it says it is
    s, kappa = _lap([(1000, 200, 2.0 * CORNER_KAPPA_THRESHOLD_1PM)])
    assert len(detect_corner_spans(s, kappa)) == 1


def test_elements_of_one_corner_merge_and_separate_corners_do_not() -> None:
    # Ascari's three parts are 11 and 14 m apart; Eau Rouge and Raidillon are 45 m apart
    s, kappa = _lap([(1000, 40, 0.02), (1090, 40, 0.02)])
    assert len(detect_corner_spans(s, kappa)) == 1

    s, kappa = _lap([(1000, 40, 0.02), (1160, 40, 0.02)])
    assert len(detect_corner_spans(s, kappa)) == 2


def test_a_corner_on_the_start_line_is_one_corner() -> None:
    s, kappa = _lap([(0, 45, 0.02)])
    spans = detect_corner_spans(s, kappa)
    assert len(spans) == 1
    assert spans[0].start_s_m == LOOP_M - 39  # 3961, the far side of the line
    assert spans[0].apex_s_m == 0


def test_the_turn_direction_comes_from_the_sign_of_the_curvature() -> None:
    s, kappa = _lap([(1000, 45, 0.02)])
    assert detect_corner_spans(s, kappa)[0].turns_left is True
    assert detect_corner_spans(s, -kappa)[0].turns_left is False


def test_corners_come_back_in_lap_order() -> None:
    s, kappa = _lap([(2500, 45, 0.02), (600, 45, 0.03), (1500, 45, 0.01)])
    spans = detect_corner_spans(s, kappa)
    assert [span.apex_s_m for span in spans] == [600, 1500, 2500]


def test_nearest_span_takes_the_short_way_round_the_lap() -> None:
    s, kappa = _lap([(50, 45, 0.02), (2000, 45, 0.02)])
    spans = detect_corner_spans(s, kappa)
    # 3990 is 60 m before the corner at 50 and 1990 m after the one at 2000
    assert nearest_span(spans, 3990, LOOP_M).apex_s_m == 50
