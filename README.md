# track-limit

Ideal racing line optimizer for GT3 cars: minimum-curvature and minimum-time
trajectory planning on real circuit geometry, with an interactive 3D track
viewer as the delivery layer.

Status: M1 (clean geometry) in progress. Validation harness (`offline/validation/`)
is written and passing against synthetic geometry; the ingestion and geometry
pipeline that must satisfy it comes next.

## Data rights and attribution

```
Track centerlines and widths: TUMFTM/racetrack-database (LGPL-3.0).
Centerlines originally derived from OpenStreetMap, © OpenStreetMap contributors (ODbL 1.0).
Elevation profile derived from OpenF1 (openf1.org), an unofficial project unaffiliated with
the Formula 1 companies. F1, FORMULA 1, and related marks are trade marks of Formula One
Licensing B.V.; this project is not endorsed by or associated with them.
Reference raceline comparison: TUMFTM/global_racetrajectory_optimization (LGPL-3.0),
Heilmeier et al., "Minimum curvature trajectory planning and control for an autonomous race
car", Vehicle System Dynamics 58(10), 2020.
```

See `third_party/README.md` for the vendoring boundary this repo enforces.

## Layout

```
/offline/            Python, ingest, geometry, NLP reference solves
/artifacts/          generated, committed, track JSON, glTF, mu-family
/src/                TypeScript frontend (later milestone)
/third_party/         vendored upstream data, unmodified, read-only
/docs/               design notes, validation results, assumptions
```
