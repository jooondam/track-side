# track-side

Ideal racing line optimizer for GT3 cars: minimum-curvature and minimum-time
trajectory planning on real circuit geometry, with an interactive 3D track
viewer as the delivery layer.

Status: M1–M5 done: clean track geometry, a velocity profile solver, a minimum-curvature path
solver, and an offline min-time NLP reference over a μ grid, all validated on real Monza. The
racing line itself is grip-invariant by design (see `docs/DESIGN_NOTES.md` section 0.1); the
interactive slider drives the velocity profile, not the path. M5 adds elevation and a 3D mesh:
real 2023 Belgian GP car-location data (OpenF1) registered onto the vendored Spa centerline
(`offline/elevation/`), producing a relative z(s) profile that reproduces Eau Rouge's ~40 m
climb and Spa's ~100 m total range, triangulated into a glTF track surface
(`offline/mesh/`, `artifacts/spa/track.glb`). M6, the in-browser 3D viewer, is next.

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
