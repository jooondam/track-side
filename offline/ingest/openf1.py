"""fetch and cache car-location samples from the OpenF1 API (openf1.org).

first HTTP ingestion path in the project, so the split matters: the impure network functions
(find_session_key, find_clean_lap_windows, download_location_samples) run once to populate a
committed cache CSV under third_party/openf1/, and everything downstream -- including every
test -- goes through the pure load_cached_location_samples instead. Tests never touch the
network, matching how casadi-dependent code is isolated elsewhere in this repo.

OpenF1's /v1/location returns x, y, z as bare integers in an arbitrary, undocumented
track-relative frame (origin arbitrary, units undocumented -- sampled magnitudes at Spa are
consistent with decimetres: raw z range 1024 against Spa's documented ~100 m elevation range).
No transform to any metre frame is published; recovering one is
offline/elevation/registration.py's job, not this module's. z is the *car's* height at ~3.7 Hz,
including pitch/heave/ride-height, not the track surface -- the shape of the profile is usable
after robust smoothing, absolute values are not (docs/DESIGN_NOTES.md section 4 point 2).

Historical data (2023 onwards) needs no API key. Only historical sessions are fetched here,
never live timing, and only a handful of clean laps per driver rather than a whole session --
keeps the committed cache small and the API load negligible.
"""

from __future__ import annotations

import csv
import json
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np

API_BASE_URL = "https://api.openf1.org/v1"

CACHE_HEADER = ["date", "driver_number", "lap_number", "x", "y", "z"]


@dataclass(frozen=True)
class LapWindow:
    """one clean lap's identity and time bounds, used to scope a /v1/location query."""

    driver_number: int
    lap_number: int
    date_start: str
    date_end: str
    lap_duration_s: float


@dataclass(frozen=True)
class RawLocationSamples:
    """cached OpenF1 location samples, one row per sample, in raw (unregistered) API units."""

    driver_number: np.ndarray
    lap_number: np.ndarray
    x_raw: np.ndarray
    y_raw: np.ndarray
    z_raw: np.ndarray
    source_path: Path

    @property
    def n_samples(self) -> int:
        return len(self.x_raw)


def _get_json(endpoint: str, params: dict[str, object]) -> list[dict]:
    """one GET against the OpenF1 API. urllib over requests: stdlib-only keeps the project's
    dependency list unchanged for a function that runs once to populate a committed cache."""
    # OpenF1 uses comparison operators embedded in the parameter name (date>...&date<...),
    # which urlencode would mangle -- build the query string manually, quoting values only.
    query = "&".join(f"{k}={urllib.parse.quote(str(v), safe=':+')}" for k, v in params.items())
    url = f"{API_BASE_URL}/{endpoint}?{query}"
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def find_session_key(circuit_short_name: str, session_name: str, year: int) -> int:
    """look up the unique session_key for e.g. ('Spa-Francorchamps', 'Race', 2023), or raise."""
    sessions = _get_json(
        "sessions",
        {"circuit_short_name": circuit_short_name, "session_name": session_name, "year": year},
    )
    if len(sessions) != 1:
        raise ValueError(
            f"expected exactly one session for {circuit_short_name!r}/{session_name!r}/{year}, "
            f"got {len(sessions)}"
        )
    return int(sessions[0]["session_key"])


def find_clean_lap_windows(
    session_key: int, driver_numbers: list[int], n_laps_per_driver: int = 2
) -> list[LapWindow]:
    """pick each driver's fastest complete non-pit-out laps and return their time windows.

    window end is date_start of the *next* lap rather than date_start + lap_duration:
    date_start is documented as approximate, so bounding by the following lap's own (equally
    approximate) start keeps the window seam-consistent -- every sample lands in exactly one
    lap window, none are dropped or double-counted at the boundary.
    """
    windows = []
    for driver_number in driver_numbers:
        laps = _get_json("laps", {"session_key": session_key, "driver_number": driver_number})
        by_number = {lap["lap_number"]: lap for lap in laps}
        clean = [
            lap
            for lap in laps
            if lap.get("lap_duration")
            and not lap.get("is_pit_out_lap")
            and lap.get("date_start")
            and by_number.get(lap["lap_number"] + 1, {}).get("date_start")
        ]
        clean.sort(key=lambda lap: lap["lap_duration"])
        for lap in clean[:n_laps_per_driver]:
            windows.append(
                LapWindow(
                    driver_number=driver_number,
                    lap_number=int(lap["lap_number"]),
                    date_start=lap["date_start"],
                    date_end=by_number[lap["lap_number"] + 1]["date_start"],
                    lap_duration_s=float(lap["lap_duration"]),
                )
            )
    return windows


def download_location_samples(
    session_key: int, lap_windows: list[LapWindow], cache_path: Path
) -> None:
    """fetch location samples for each lap window and write the cache CSV. No-op if it exists."""
    if cache_path.exists():
        return

    rows = []
    for window in lap_windows:
        samples = _get_json(
            "location",
            {
                "session_key": session_key,
                "driver_number": window.driver_number,
                "date>": window.date_start,
                "date<": window.date_end,
            },
        )
        samples.sort(key=lambda s: s["date"])
        for s in samples:
            rows.append(
                [s["date"], window.driver_number, window.lap_number, s["x"], s["y"], s["z"]]
            )

    if not rows:
        raise ValueError("OpenF1 returned no location samples for any requested lap window")

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with cache_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(CACHE_HEADER)
        writer.writerows(rows)


def load_cached_location_samples(cache_path: Path) -> RawLocationSamples:
    """load a location-sample cache CSV, mirroring parse_tumftm_csv's validation style."""
    with cache_path.open(newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        if header != CACHE_HEADER:
            raise ValueError(f"unexpected cache header {header}, expected {CACHE_HEADER}")
        rows = list(reader)

    if not rows:
        raise ValueError(f"empty location cache {cache_path}")

    driver_number = np.array([int(r[1]) for r in rows])
    lap_number = np.array([int(r[2]) for r in rows])
    x_raw = np.array([float(r[3]) for r in rows])
    y_raw = np.array([float(r[4]) for r in rows])
    z_raw = np.array([float(r[5]) for r in rows])

    if not (
        np.all(np.isfinite(x_raw)) and np.all(np.isfinite(y_raw)) and np.all(np.isfinite(z_raw))
    ):
        raise ValueError(f"non-finite values in {cache_path}")

    return RawLocationSamples(driver_number, lap_number, x_raw, y_raw, z_raw, cache_path)
