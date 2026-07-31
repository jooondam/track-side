"""parse_raceline_csv: format acceptance and rejection paths."""

from __future__ import annotations

import numpy as np
import pytest

from offline.ingest.raceline import parse_raceline_csv

HEADER = "# x_m,y_m\n"


def _write_csv(tmp_path, rows: str):
    path = tmp_path / "raceline.csv"
    path.write_text(HEADER + rows)
    return path


def test_parses_well_formed_csv(tmp_path) -> None:
    rows = "0.0,0.0\n1.0,0.0\n1.0,1.0\n0.0,1.0\n"
    raw = parse_raceline_csv(_write_csv(tmp_path, rows), circuit_name="Square")
    assert raw.circuit_name == "Square"
    assert len(raw.x_m) == 4
    assert np.allclose(raw.y_m, [0.0, 0.0, 1.0, 1.0])


def test_wrong_column_count_raises(tmp_path) -> None:
    rows = "0.0,0.0,5.0\n1.0,0.0,5.0\n"
    with pytest.raises(ValueError, match="expected 2 columns"):
        parse_raceline_csv(_write_csv(tmp_path, rows), circuit_name="Bad")


def test_coincident_points_raise(tmp_path) -> None:
    rows = "0.0,0.0\n0.0,0.0\n1.0,1.0\n"
    with pytest.raises(ValueError, match="coincident"):
        parse_raceline_csv(_write_csv(tmp_path, rows), circuit_name="Bad")
