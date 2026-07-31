"""tests for the ribbon triangulation against synthetic tracks with known geometry."""

from __future__ import annotations

import numpy as np
import pytest

from offline.elevation.profile import ElevationProfile
from offline.geometry.pipeline import build_track
from offline.mesh.ribbon import build_ribbon_mesh

HEADER = "# x_m,y_m,w_tr_right_m,w_tr_left_m\n"


@pytest.fixture()
def circle_track(tmp_path):
    theta = np.linspace(0.0, 2 * np.pi, 300, endpoint=False)
    x, y = 100.0 * np.cos(theta), 100.0 * np.sin(theta)
    lines = [f"{xi:.6f},{yi:.6f},4.000,4.000" for xi, yi in zip(x, y)]
    path = tmp_path / "circle.csv"
    path.write_text(HEADER + "\n".join(lines) + "\n")
    return build_track(path, circuit_name="TestCircle", spacing_m=2.0, gps_noise_std_m=0.0)


def _flat_elevation(track, z: float = 0.0) -> ElevationProfile:
    return ElevationProfile(
        circuit_name=track.circuit_name,
        source_path=track.source_path,
        bin_size_m=25.0,
        n_samples_used=0,
        n_samples_rejected=0,
        s_m=track.s_m,
        z_m=np.full(track.n_points, z),
    )


def _hilly_elevation(track) -> ElevationProfile:
    z = 10.0 * np.sin(2 * np.pi * track.s_m / track.loop_length_m)
    return ElevationProfile(
        circuit_name=track.circuit_name,
        source_path=track.source_path,
        bin_size_m=25.0,
        n_samples_used=0,
        n_samples_rejected=0,
        s_m=track.s_m,
        z_m=z - np.min(z),
    )


def test_topology_counts_and_index_validity(circle_track) -> None:
    mesh = build_ribbon_mesh(circle_track, _flat_elevation(circle_track))

    n = circle_track.n_points - 1  # closed duplicate dropped
    assert mesh.vertices.shape == (2 * n, 3)
    assert mesh.triangles.shape == (2 * n, 3)
    assert mesh.normals.shape == (2 * n, 3)
    assert mesh.triangles.max() < len(mesh.vertices)
    # every vertex is used by at least one triangle (no orphans at the wraparound seam)
    assert len(np.unique(mesh.triangles)) == len(mesh.vertices)


def test_normals_point_up_on_flat_track(circle_track) -> None:
    mesh = build_ribbon_mesh(circle_track, _flat_elevation(circle_track))

    np.testing.assert_allclose(mesh.normals[:, 2], 1.0, atol=1e-6)
    np.testing.assert_allclose(np.linalg.norm(mesh.normals, axis=1), 1.0, atol=1e-6)


def test_no_degenerate_triangles_and_consistent_winding(circle_track) -> None:
    mesh = build_ribbon_mesh(circle_track, _hilly_elevation(circle_track))

    a = mesh.vertices[mesh.triangles[:, 0]].astype(np.float64)
    b = mesh.vertices[mesh.triangles[:, 1]].astype(np.float64)
    c = mesh.vertices[mesh.triangles[:, 2]].astype(np.float64)
    face_normals = np.cross(b - a, c - a)
    areas = 0.5 * np.linalg.norm(face_normals, axis=1)

    assert np.all(areas > 1e-6)
    assert np.all(face_normals[:, 2] > 0)  # every face still faces up, even on the hill


def test_elevation_is_attached(circle_track) -> None:
    elevation = _hilly_elevation(circle_track)
    mesh = build_ribbon_mesh(circle_track, elevation)

    # left and right vertex of each cross-section share the same z (flat cross-section,
    # assumption #3), and the z range matches the profile's
    left_z = mesh.vertices[0::2, 2]
    right_z = mesh.vertices[1::2, 2]
    np.testing.assert_allclose(left_z, right_z, atol=1e-6)
    assert float(left_z.max() - left_z.min()) == pytest.approx(
        elevation.total_range_m, rel=1e-3
    )


def test_mesh_width_matches_track_width(circle_track) -> None:
    mesh = build_ribbon_mesh(circle_track, _flat_elevation(circle_track))

    widths = np.linalg.norm(mesh.vertices[0::2] - mesh.vertices[1::2], axis=1)
    expected = circle_track.w_tr_left_m[:-1] + circle_track.w_tr_right_m[:-1]
    np.testing.assert_allclose(widths, expected, rtol=1e-3)


def test_mismatched_elevation_grid_raises(circle_track, tmp_path) -> None:
    bad = ElevationProfile(
        circuit_name="X",
        source_path=tmp_path,
        bin_size_m=25.0,
        n_samples_used=0,
        n_samples_rejected=0,
        s_m=circle_track.s_m[:-10],
        z_m=np.zeros(circle_track.n_points - 10),
    )
    with pytest.raises(ValueError, match="does not match the track grid"):
        build_ribbon_mesh(circle_track, bad)
