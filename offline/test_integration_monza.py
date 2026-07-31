"""end-to-end build_track() against the real vendored Monza centerline.

this is the automated form of the M1 test criteria: loop closes, zero normal crossings,
no absurd curvature. The visual "kappa matches TUM's published plots" check is a separate,
human step against artifacts/monza/curvature.png (see offline/build_track.py).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from offline.geometry.pipeline import build_track

MONZA_CSV = Path(__file__).resolve().parent.parent / "third_party" / "Monza.csv"


def test_monza_builds_and_passes_hard_gates() -> None:
    track = build_track(MONZA_CSV, circuit_name="Monza", spacing_m=1.0, gps_noise_std_m=0.1)

    assert np.max(np.abs(track.kappa_1pm)) < 1.0 / 3.0, "no real corner has a 3 m radius"
    assert 5000 < track.loop_length_m < 6500, "Monza's real length is ~5.79 km"
    assert track.n_points == round(track.loop_length_m / track.spacing_m) + 1
