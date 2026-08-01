"""build a robust z(s) elevation profile from registered car-location samples.

the input z is car height at ~3.7 Hz -- pitch, heave, ride-height and registration error
included -- so the pipeline is deliberately shaped around robustness rather than fidelity:
assign each sample to its nearest arc-length position on the centerline, discard samples that
land implausibly far from the track (misregistration leftovers), take the *median* z per coarse
arc-length bin (medians shrug off the asymmetric outliers that kerb strikes and braking-dive
produce, where a mean would chase them), then fit a periodic smoothing spline through the bin
medians and evaluate it back onto the full-resolution grid. Coarse-then-upsample, the same
shape M3's QP and M4's NLP already use.

z_m in the result is *relative* elevation above the circuit's lowest point, by construction:
absolute OpenF1 z values are untrustworthy (docs/DESIGN_NOTES.md section 4 point 2 -- the
*shape* of the profile, heavily smoothed and averaged across laps, is the usable part). Frame
it that way everywhere downstream; claiming survey-accurate absolute elevation would be wrong.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.interpolate import splev, splrep
from scipy.spatial import cKDTree

from offline.geometry.pipeline import TrackGeometry


@dataclass(frozen=True)
class ElevationProfile:
    circuit_name: str
    source_path: Path
    bin_size_m: float
    n_samples_used: int
    n_samples_rejected: int
    s_m: np.ndarray
    z_m: np.ndarray

    @property
    def total_range_m(self) -> float:
        return float(np.max(self.z_m) - np.min(self.z_m))

    def to_json_dict(self) -> dict:
        return {
            "schema_version": 1,
            "meta": {
                "circuit_name": self.circuit_name,
                "source": str(self.source_path),
                "method": (
                    "median-binned OpenF1 car z, periodic smoothing spline; relative shape "
                    "only, z_m is height above the circuit's lowest point"
                ),
                "bin_size_m": self.bin_size_m,
                "n_samples_used": self.n_samples_used,
                "n_samples_rejected": self.n_samples_rejected,
                "total_range_m": self.total_range_m,
            },
            "profile": {
                "s_m": self.s_m.tolist(),
                "z_m": self.z_m.tolist(),
            },
        }


def build_elevation_profile(
    track: TrackGeometry,
    x_m: np.ndarray,
    y_m: np.ndarray,
    z_m: np.ndarray,
    bin_size_m: float = 25.0,
    z_noise_std_m: float = 0.5,
) -> ElevationProfile:
    """turn registered (x, y, z) samples in metres into a validated z(s) profile, or raise.

    x/y/z must already be transformed into the track's metre frame
    (offline/elevation/registration.py). z_noise_std_m sets the smoothing spline's residual
    budget the same way gps_noise_std_m does for the centerline fit in build_track:
    smoothing_factor = n_bins * z_noise_std_m^2.
    """
    if not (len(x_m) == len(y_m) == len(z_m)):
        raise ValueError("x_m, y_m, z_m must be the same length")

    centerline_tree = cKDTree(np.column_stack([track.x_m, track.y_m]))
    distances, indices = centerline_tree.query(np.column_stack([x_m, y_m]))

    # a sample farther from the centerline than the local track width is misregistered or
    # off-track (gravel excursion, pit lane); the width bound is generous on purpose since
    # rejecting a good sample costs little and keeping a bad one drags the bin median.
    width_at = track.w_tr_left_m[indices] + track.w_tr_right_m[indices]
    keep = distances <= width_at
    n_rejected = int(np.sum(~keep))

    s_kept = track.s_m[indices[keep]]
    z_kept = z_m[keep]
    if len(z_kept) < 100:
        raise ValueError(f"only {len(z_kept)} usable samples after off-track rejection")

    n_bins = max(4, int(round(track.loop_length_m / bin_size_m)))
    bin_edges = np.linspace(0.0, track.loop_length_m, n_bins + 1)
    bin_index = np.clip(np.digitize(s_kept, bin_edges) - 1, 0, n_bins - 1)

    bin_s, bin_z = [], []
    for b in range(n_bins):
        in_bin = bin_index == b
        if np.any(in_bin):
            bin_s.append(0.5 * (bin_edges[b] + bin_edges[b + 1]))
            bin_z.append(float(np.median(z_kept[in_bin])))
    bin_s = np.array(bin_s)
    bin_z = np.array(bin_z)

    # a long run of empty bins means part of the lap has no coverage at all; a periodic spline
    # would bridge it with an invented arc, which is worse than failing loudly.
    gaps = np.diff(np.concatenate([bin_s, [bin_s[0] + track.loop_length_m]]))
    if np.max(gaps) > 5.0 * bin_size_m:
        raise ValueError(
            f"elevation coverage gap of {np.max(gaps):.0f} m (> 5 * bin_size_m); "
            "not enough samples to trust a periodic fit across it"
        )

    # periodic 1D smoothing spline through the bin medians. splrep(per=1) needs the wrap point
    # supplied explicitly, mirroring fit_closed_centerline_spline's handling of splprep.
    wrap_s = np.append(bin_s, bin_s[0] + track.loop_length_m)
    wrap_z = np.append(bin_z, bin_z[0])
    smoothing_factor = len(bin_s) * z_noise_std_m**2
    tck = splrep(wrap_s, wrap_z, per=1, k=3, s=smoothing_factor)

    z_profile = splev(np.mod(track.s_m, track.loop_length_m), tck)
    z_profile = np.asarray(z_profile) - np.min(z_profile)

    if not np.all(np.isfinite(z_profile)):
        raise ValueError("non-finite values in fitted elevation profile")

    return ElevationProfile(
        circuit_name=track.circuit_name,
        source_path=track.source_path,
        bin_size_m=bin_size_m,
        n_samples_used=int(np.sum(keep)),
        n_samples_rejected=n_rejected,
        s_m=track.s_m,
        z_m=z_profile,
    )


def load_elevation_profile(json_path: Path) -> ElevationProfile:
    """load an elevation.json artifact written by build_elevation.py back into a profile.

    lets downstream stages (the mesh builder) compose on the committed artifact instead of
    re-running registration -- the same artifact-pipeline shape the M2-M4 CLIs already use.
    """
    payload = json.loads(json_path.read_text())
    meta = payload["meta"]
    return ElevationProfile(
        circuit_name=meta["circuit_name"],
        source_path=Path(meta["source"]),
        bin_size_m=float(meta["bin_size_m"]),
        n_samples_used=int(meta["n_samples_used"]),
        n_samples_rejected=int(meta["n_samples_rejected"]),
        s_m=np.array(payload["profile"]["s_m"]),
        z_m=np.array(payload["profile"]["z_m"]),
    )


def drape_elevation(
    s_m: np.ndarray, loop_length_m: float, elevation: ElevationProfile
) -> np.ndarray:
    """sample an elevation profile onto another arc-length grid by fractional loop position.

    a refit racing line has a slightly different arc-length parametrization than the
    centerline the profile was built on (5784.44 m vs 5789.84 m at Monza), so matching by
    fraction around the loop rather than by raw s is the same approximation
    build_line_from_offsets already makes for track widths. both grids describe the same
    physical circuit, so the fractional map is exact at every landmark and only redistributes
    the metre-scale spacing between them.

    the loop-closure gate matters more than it looks. M8 made grade part of the physics, and
    the forward and backward passes only agree if the elevation gained around a lap is exactly
    the elevation lost. a residual here shows up as an energy leak that stops v(0) == v(L) from
    converging, so the closure is asserted and then enforced exactly rather than trusted.
    """
    line_frac = s_m / loop_length_m
    profile_frac = elevation.s_m / elevation.s_m[-1]
    z_m = np.interp(line_frac, profile_frac, elevation.z_m, period=1.0)

    closure_gap = abs(float(z_m[-1] - z_m[0]))
    if closure_gap > 1e-6:
        raise AssertionError(
            f"elevation does not close around the loop: z[-1] - z[0] = {closure_gap:.3e} m. "
            "grade would inject net energy per lap and the velocity profile would not converge"
        )
    z_m[-1] = z_m[0]
    return z_m
