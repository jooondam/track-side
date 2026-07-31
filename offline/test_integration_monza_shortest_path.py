"""end-to-end shortest-path QP solve against the real vendored Monza track.

mirrors test_integration_monza_line.py's structure. Monza's chicanes (Variante del Rettifilo,
della Roggia, Ascari) are exactly the geometry DESIGN_NOTES.md section 7's sanity check has in
mind ("min-curvature line should be *longer* than shortest-path, and both shorter than the
centerline through a chicane") -- a synthetic single-direction stadium turn doesn't reliably
show this (see offline/mincurv/test_shortest_path.py), but a real circuit with real chicanes
should.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from offline.geometry.pipeline import build_track
from offline.mincurv.line import build_mincurv_line
from offline.mincurv.shortest_path import build_shortest_path_line

MONZA_CSV = Path(__file__).resolve().parent.parent / "third_party" / "Monza.csv"


@pytest.fixture(scope="module")
def monza_track():
    return build_track(MONZA_CSV, circuit_name="Monza", spacing_m=1.0, gps_noise_std_m=0.1)


@pytest.fixture(scope="module")
def monza_shortest_path_line(monza_track):
    return build_shortest_path_line(monza_track, margin_m=1.0, spacing_m=1.0)


@pytest.fixture(scope="module")
def monza_mincurv_line(monza_track):
    return build_mincurv_line(monza_track, margin_m=1.0, spacing_m=1.0)


def test_shortest_path_converges_and_stays_in_bounds(monza_shortest_path_line) -> None:
    # build_shortest_path_line's internal hard gates (assert_loop_closes,
    # assert_within_track_bounds) already ran without raising -- reaching this point is itself
    # a pass of those checks.
    assert np.all(np.isfinite(monza_shortest_path_line.x_m))
    assert np.all(np.isfinite(monza_shortest_path_line.y_m))


def test_shortest_path_shorter_than_mincurv_shorter_than_centerline(
    monza_track, monza_shortest_path_line, monza_mincurv_line
) -> None:
    assert monza_shortest_path_line.loop_length_m < monza_mincurv_line.loop_length_m
    assert monza_mincurv_line.loop_length_m < monza_track.loop_length_m
