"""end-to-end elevation build against real vendored Spa geometry + real cached OpenF1 data.

automated form of M5's DESIGN_NOTES.md deliverable's elevation half: registration onto the
real circuit, profile robustness, and the "Eau Rouge ~40 m rise / ~100 m total range, wrong by
a factor of two and you'd see it" sanity check -- on real data, no network (the cache under
third_party/openf1/ is committed).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from offline.elevation.profile import build_elevation_profile
from offline.elevation.registration import apply_similarity_transform, register_via_icp
from offline.geometry.pipeline import build_track
from offline.ingest.openf1 import load_cached_location_samples
from offline.validation.checks import assert_elevation_plausible

SPA_CSV = Path(__file__).resolve().parent.parent / "third_party" / "Spa.csv"
OPENF1_CACHE = (
    Path(__file__).resolve().parent.parent / "third_party" / "openf1" / "spa_2023_race_location.csv"
)

SPA_EAU_ROUGE_RISE_M = 40.0
SPA_TOTAL_RANGE_M = 100.0


@pytest.fixture(scope="module")
def spa_track():
    return build_track(SPA_CSV, circuit_name="Spa", spacing_m=1.0, gps_noise_std_m=0.1)


@pytest.fixture(scope="module")
def spa_samples():
    return load_cached_location_samples(OPENF1_CACHE)


@pytest.fixture(scope="module")
def spa_registration(spa_track, spa_samples):
    lap_ids = np.unique(
        np.column_stack([spa_samples.driver_number, spa_samples.lap_number]), axis=0
    )
    best_mask = None
    for driver, lap in lap_ids:
        mask = (spa_samples.driver_number == driver) & (spa_samples.lap_number == lap)
        if best_mask is None or np.sum(mask) > np.sum(best_mask):
            best_mask = mask
    source = np.column_stack([spa_samples.x_raw[best_mask], spa_samples.y_raw[best_mask]])
    target = np.column_stack([spa_track.x_m, spa_track.y_m])
    return register_via_icp(source, target)


@pytest.fixture(scope="module")
def spa_elevation(spa_track, spa_samples, spa_registration):
    xy = np.column_stack([spa_samples.x_raw, spa_samples.y_raw])
    if spa_registration.mirrored:
        xy[:, 0] = -xy[:, 0]
    moved = apply_similarity_transform(
        xy, spa_registration.scale, spa_registration.rotation, spa_registration.translation
    )
    return build_elevation_profile(
        spa_track, moved[:, 0], moved[:, 1], spa_samples.z_raw * spa_registration.scale
    )


def test_registration_scale_is_decimetres(spa_registration) -> None:
    # OpenF1's units are undocumented; DESIGN_NOTES section 4's "sample magnitudes suggest
    # decimetres" is confirmed hard by the recovered scale landing within 1% of 0.1.
    assert spa_registration.scale == pytest.approx(0.1, rel=0.01)


def test_registration_residual_within_track_width(spa_registration) -> None:
    # the car drives the racing line, not the centerline, so the residual should be a few
    # metres (lateral offset), never tens of metres (a misregistration).
    assert spa_registration.rmse_m < 5.0


def test_elevation_profile_plausible_for_spa(spa_elevation) -> None:
    assert_elevation_plausible(
        spa_elevation.z_m,
        spa_elevation.s_m,
        expected_max_rise_m=SPA_EAU_ROUGE_RISE_M,
        expected_total_range_m=SPA_TOTAL_RANGE_M,
    )


def test_steepest_rise_is_in_the_eau_rouge_sector(spa_elevation) -> None:
    # magnitude alone could be right by luck; the steepest climb must also be in the right
    # *place*. Eau Rouge/Raidillon starts ~1.1 km after the start/finish line (past La Source
    # and the downhill Kemmel straight run); assert the steepest 500 m rise begins somewhere
    # in the first ~2 km, not out at Stavelot or Blanchimont.
    z, s = spa_elevation.z_m, spa_elevation.s_m
    window = int(round(500.0 / float(np.median(np.diff(s)))))
    rises = z[window:] - z[:-window]
    s_at_steepest = s[int(np.argmax(rises))]
    assert 500.0 < s_at_steepest < 2000.0


def test_profile_is_periodic(spa_elevation) -> None:
    assert abs(float(spa_elevation.z_m[0] - spa_elevation.z_m[-1])) < 0.5
