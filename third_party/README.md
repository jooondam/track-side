# /third_party/ (read-only)

This directory holds vendored data from upstream projects, unmodified, with each
project's license text intact alongside it.

Do not reformat, rewrite, re-encode, or otherwise touch files placed here. An
unmodified copy with the license notice present is the basis for LGPL/ODbL
compliance (see `/docs/DESIGN_NOTES.md` §5). If a file here needs to change, that
is a licensing question to raise explicitly, not a cleanup task.

Expected contents: TUMFTM `racetrack-database` centerline CSVs (`tracks/`), raceline CSVs
(`racelines/`), and their `LICENSE` file.

`openf1/` holds cached historical car-location samples fetched once from the OpenF1 API
(openf1.org, an unofficial project unaffiliated with the Formula 1 companies) by
`offline/ingest/openf1.py` -- raw API responses reduced to CSV, not covered by the TUMFTM
LICENSE file. See the attribution block in the repository README; rights in the underlying
timing data sit with Formula 1, which is why only a handful of laps are cached here rather
than bulk telemetry (docs/DESIGN_NOTES.md §5).
