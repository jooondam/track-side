"""tests for the OpenF1 cache loader. Network functions are not tested (they run once to
populate the committed cache; the loader is what everything downstream depends on)."""

from __future__ import annotations

import numpy as np
import pytest

from offline.ingest.openf1 import CACHE_HEADER, load_cached_location_samples


def _write_cache(path, rows):
    lines = [",".join(CACHE_HEADER)] + [",".join(str(v) for v in row) for row in rows]
    path.write_text("\n".join(lines) + "\n")


def test_loads_valid_cache(tmp_path) -> None:
    path = tmp_path / "cache.csv"
    _write_cache(
        path,
        [
            ["2023-07-30T14:02:24.295000+00:00", 1, 32, -537, 1462, 4140],
            ["2023-07-30T14:02:24.475000+00:00", 1, 32, -602, 1560, 4143],
            ["2023-07-30T13:57:08.100000+00:00", 44, 29, 100, -200, 4000],
        ],
    )

    samples = load_cached_location_samples(path)

    assert samples.n_samples == 3
    np.testing.assert_array_equal(samples.driver_number, [1, 1, 44])
    np.testing.assert_array_equal(samples.lap_number, [32, 32, 29])
    np.testing.assert_allclose(samples.x_raw, [-537.0, -602.0, 100.0])
    np.testing.assert_allclose(samples.z_raw, [4140.0, 4143.0, 4000.0])


def test_wrong_header_raises(tmp_path) -> None:
    path = tmp_path / "cache.csv"
    path.write_text("date,driver,x,y,z\n2023-01-01,1,0,0,0\n")
    with pytest.raises(ValueError, match="unexpected cache header"):
        load_cached_location_samples(path)


def test_empty_cache_raises(tmp_path) -> None:
    path = tmp_path / "cache.csv"
    path.write_text(",".join(CACHE_HEADER) + "\n")
    with pytest.raises(ValueError, match="empty location cache"):
        load_cached_location_samples(path)


def test_non_finite_raises(tmp_path) -> None:
    path = tmp_path / "cache.csv"
    _write_cache(path, [["2023-01-01T00:00:00+00:00", 1, 1, "nan", 0, 0]])
    with pytest.raises(ValueError, match="non-finite"):
        load_cached_location_samples(path)
