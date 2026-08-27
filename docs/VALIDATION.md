# Validation

What has been measured, against what, and what the numbers do not cover.

Every table here is printed by one command:

```
pip install -e ".[dev,reference]"
python -m offline.validation.report          # everything on this page except the port table
npx vitest run                               # the TypeScript port, against committed fixtures
```

The report computes from the vendored inputs at the moment it runs, rather than reading a
recorded answer. That distinction earned its place: the committed NLP reference in `artifacts/`
sat at pre-M8 physics for four weeks after M8 landed, because the numbers lived in a JSON file
that only a human re-ran, and nothing said so.

Solved for a GT3-class car (1300 kg, 2.8 m² ClA, 1.35 m² CdA, 410 kW, 2.65 m wheelbase, 44%
front, 62% front brake bias, k = 0.10) that nobody has measured. See "What this is not" at the
end before quoting any absolute number from it.

---

## 1. The decomposition against a minimum-time reference

The shipped answer is a **decomposition**: solve a minimum-curvature path once, then solve a
velocity profile along it. That is what makes the grip slider interactive, because the path does
not depend on μ. It is also not optimal, and the size of that gap is the first thing anyone
should ask for.

`offline/reference/mintime.py` is the check: a full minimum-time NLP over the same geometry,
same vehicle, same physics, solved by IPOPT offline. It is not a different model, it is the same
model solved simultaneously instead of in two stages.

**Spa**

| μ | mincurv + profile | min-time NLP | delta | |
|---|---|---|---|---|
| 0.80 | 185.46 s | 171.08 s | +14.38 s | +8.40% |
| 1.00 | 165.91 s | 155.83 s | +10.08 s | +6.47% |
| 1.20 | 153.23 s | 144.93 s | +8.30 s | +5.73% |
| 1.40 | 144.21 s | did not converge | | |

**Monza**

| μ | mincurv + profile | min-time NLP | delta | |
|---|---|---|---|---|
| 0.80 | 138.24 s | 127.18 s | +11.07 s | +8.70% |
| 1.00 | 124.82 s | 117.55 s | +7.26 s | +6.18% |
| 1.20 | 116.50 s | 111.52 s | +4.98 s | +4.46% |
| 1.40 | 110.96 s | 107.06 s | +3.90 s | +3.64% |

The decomposition costs **3.6% to 8.7%**, and the gap **widens as grip falls**. That direction is
the interesting part and it has a mechanism: the lower the grip, the more a lap is decided by
where the car brakes and gets back to power, and the less a path chosen purely for curvature has
to do with the fastest way round. At high grip the two converge, because a min-curvature line is
close to right when the car is cornering-limited nearly everywhere.

Spa at μ1.40 hits IPOPT's 3000-iteration cap and is reported as a failure rather than shipped as
a number. The sweep exists partly to find where the NLP breaks down, so a non-converged solve is
a result, not a gap in the table.

## 2. What M8's physics cost, separated

Grade, three-dimensional segment length, vertical curvature, longitudinal load transfer and tyre
load sensitivity arrived in one commit. Which of them moves the lap time is not something that
commit can answer, so the report solves the corners of the grid. At μ1.20:

| | Spa | Monza |
|---|---|---|
| flat road, load-insensitive tyre | 151.88 s | 115.76 s |
| **tyre load sensitivity only** (k = 0.10) | 153.06 s (**+1.18**) | 116.50 s (**+0.74**) |
| **grade only** | 152.05 s (**+0.16**) | 115.76 s (**+0.00**) |
| both, as shipped | 153.23 s (+1.35) | 116.50 s (+0.74) |

Two things worth reading off this.

**The tyre model dominates, not the hill.** M8 was planned around elevation entering the physics,
and the elevation is worth 0.16 s at Spa while the load-sensitive tyre is worth 1.18 s. The
planning note predicted "slower by 0.5 to 1.5 s from load sensitivity alone" before any of it was
written; measured, 0.74 s and 1.18 s, inside the predicted band at both circuits.

**Monza's grade costs nothing, and it should not.** 11.5 m of range over 5.8 km. Its grade term
comes out at ±0.01 s across the whole slider, which is the closest thing here to a null result on
purpose: a circuit with no hills that came out faster or slower for having them would mean the
sign convention was wrong somewhere.

Grade alone, across the slider:

| μ | Spa graded | Spa flat | cost | Monza cost |
|---|---|---|---|---|
| 0.80 | 185.46 s | 185.33 s | +0.13 s | -0.01 s |
| 1.00 | 165.91 s | 165.69 s | +0.22 s | -0.00 s |
| 1.20 | 153.23 s | 153.06 s | +0.18 s | +0.00 s |
| 1.40 | 144.21 s | 144.05 s | +0.16 s | +0.01 s |

**A correction.** `docs/DESIGN_NOTES.md` has said since M8 that "Spa is 0.26 s slower with real
elevation than without". It does not reproduce: the cost is 0.13 to 0.22 s depending on grip, and
0.18 s at the reference μ. The claim was recorded once from one solve and never re-run, which is
the argument for this page existing.

## 3. The TypeScript port against the Python solver

The viewer re-solves in the browser on every drag of the grip slider, so the solver exists twice.
The port is held to the original rather than trusted: `src/solver/velocity.test.ts` replays
committed fixtures generated by the Python implementation, on both circuits, at every fixture μ.

| quantity | tolerance | what sets it |
|---|---|---|
| lap time | 1e-6 s | the fixture's own rounding |
| v(s), every point | 5e-6 m/s | v recorded at 6 dp, so a 5e-7 half-ulp |
| axle loads Fz, every point | 0.5 N | Fz recorded at 1 dp |
| phase labels | exact | accelerating / braking / holding |

These are the fixtures' quantisation floor with an order of magnitude of headroom, not a chosen
bound. The generator solves the identical rounded arrays the fixture ships, so the only difference
left is the rounding of the recorded answers. Anything that fires there is a port divergence and
nothing else.

`fz_front_n` and `fz_rear_n` are in the fixture for a specific reason: without them the port's
load model would be validated only indirectly through v(s), and a transfer sign error that
cancels in the composed budget would pass.

The fixed-point iteration counts (`LOAD_TRANSFER_ITERS`, `CAP_ITERS`) are carried in the fixture
metadata and asserted in both languages, so "three iterations is enough" is checked rather than
assumed on each side separately. The count itself is measured against a solve iterated to 1e-12
in `offline/velocity/test_loads.py`, not argued from a contraction estimate. The estimate was
wrong, as it happens: braking divides the front axle's capacity by the brake bias and lifts the
loop gain from about 0.12 to about 0.20.

## 4. Solve time

| | measured | budget |
|---|---|---|
| Spa, TypeScript, in-browser | 12.0 ms | 16 ms, one frame at 60 fps |
| Monza, TypeScript, in-browser | 7.8 ms | 16 ms |
| Spa, Python NLP reference, per μ | 4 to 7 s | offline, no budget |
| Monza, Python NLP reference, per μ | 6 to 8 s | offline, no budget |

The 16 ms budget is a claim about the reader's machine, so CI asserts a looser bound scaled past
the observed spread on shared runners and logs the measured time. The tight number is verified
locally and, in the end, in the browser.

## 5. The racing line against a published one

TUMFTM publish a raceline for both of these circuits, generated by their own optimiser. Ours is a
minimum-curvature QP over lateral offsets in the Frenet frame, theirs is not the same objective,
so this is a plausibility check and not an error measurement.

| | Spa | Monza |
|---|---|---|
| mean lateral deviation | 0.78 m | 1.17 m |
| max lateral deviation | 12.16 m | 7.78 m |
| curvature RMSE | 0.0029 1/m | 0.0019 1/m |
| our loop length | 7005.3 m | 5784.4 m |
| TUM loop length | 6938.6 m | 5758.0 m |

Sub-metre mean deviation on a road 10 to 20 m wide is the agreement worth having. **Our line is
consistently longer**, by 67 m at Spa and 26 m at Monza, and that is the objective showing
through rather than an error: minimum curvature buys radius with distance, and a time-optimal
line does not make that trade everywhere.

## 6. Elevation

z(s) is registered from 2023 OpenF1 car-location traces onto the vendored centrelines. OpenF1's
frame has an arbitrary origin, an arbitrary rotation and an unknown scale, so the transform is
fitted by ICP rather than assumed.

| | Spa | Monza |
|---|---|---|
| fitted scale | 0.099962 | 0.099960 |
| ICP RMSE | 2.62 m | 2.31 m |
| ICP iterations | 25 | 31 |
| samples cached / on the fitted lap | 2508 / 427 | 1972 / 336 |
| total elevation range | 102.1 m | 11.5 m |

**The fitted scale is the strongest single result on this page.** Nothing told the fit that
OpenF1's units are decimetres. It recovered 0.099962 and 0.099960 independently on two circuits,
against a true 0.1: five significant figures, from two datasets that share no code path beyond the
algorithm. A registration that was wrong would not land there twice.

The ranges corroborate: Spa is documented at about 100 m and comes out at 102.1 m; Monza at about
12 m and comes out at 11.5 m.

**The Eau Rouge climb, with its window stated.** "About 40 m" is the number usually quoted and it
is a claim about a stretch of road nobody names. From the lowest point of the compression, found
between two measured corners rather than at a hand-picked arc length:

| from the compression at s = 1022 | rise |
|---|---|
| over the next 300 m | 24.1 m |
| over the next 500 m | 34.3 m |
| over the next 650 m | 40.8 m |
| all the way to Les Combes | 72.9 m |

So the 40 m reproduces, over 650 m. Steepest 50 m gradient on the climb: **12.2% at s = 1184**,
which is Raidillon. The real gradient there is steeper. That is the 25 m binning and the smoothing
spline, and it is register row 15: the grade is a low pass of reality, and a low pass takes the
peaks first.

## 7. Corner positions

Corner arc lengths were hand-authored from circuit maps until 2026-08-27, and every Monza corner
was between 100 m and 340 m short of the corner it named, because the map's frame is not the
generated line's frame. Four gates passed on that data, and all four checked the file against
itself.

They are now measured from the shipped line by `offline/landmarks/geometry.py` and held there:
`assert_corners_match_geometry` fails if an authored apex is more than 25 m from a curvature
maximum in the line, or a turn-in more than 25 m from where that curvature begins, or if two
named corners claim one stretch of road.

What is still authored is which corners get a name and which apex of a complex carries it. Those
are human calls. Where the corner is, is not.

## 8. The braking report, and the one number that survives everything

Braking points are reported against the distance boards a driver reads on the way in, at
`src/solver/brakingPoints.ts`. The boards are the standard 300/200/100/50 set placed that far
before a measured turn-in. They are not surveyed, so **every board column carries roughly ±10 m
that nothing here can remove**.

The shift between two grip levels does not. Both solves read the same boards, so however wrong a
board is, the difference between them is exact. Measured on Monza, μ1.40 against μ1.20:

| corner | brakes later by |
|---|---|
| Variante del Rettifilo | 30 m |
| Variante della Roggia | 28 m |
| Variante Ascari | 27 m |
| Parabolica | 27 m |
| Lesmo 1 | 12 m |
| Lesmo 2 | 11 m |

Every corner braked for at both grip levels moves later with more grip, which is asserted rather
than observed (`src/solver/brakingPoints.test.ts`). Curva Grande appears in neither list: it is a
291 m radius the car carries full speed through at every grip the slider offers, so it has no
braking point rather than a wrong one.

One structural result falls out of the same table. The car is **front-limited at every corner of
both circuits at every grip level**, with the rear carrying 19 to 42% of its friction circle
unused. That is not a bug, it is what a 62% front brake bias on a 44% front weight distribution
does, and a real driver would move the bias back. It is visible only because M8 split the axles.

## 9. What this is not

Driven from the assumptions register in `docs/DESIGN_NOTES.md` section 6, which has 27 rows. The
ones that bound what may be claimed:

- **The vehicle is a model of no particular car.** Mass, aero and power are GT3-class figures, not
  a homologation sheet. `cg_height_m = 0.30` is not published for any GT3 and is a guess inside a
  plausible band. There is no ggv diagram behind any of it.
- **The tyre has no slip angle, no temperature, no camber and no wear.** Grip is μ times normal
  load, with one power-law load sensitivity at k = 0.10.
- **Load transfer is longitudinal and quasi-steady only.** No roll, no pitch dynamics, no yaw. A
  corner's balance is split between axles in proportion to axle grip, not solved from a yaw moment.
- **Aero balance and brake bias are fixed.** Both are adjustable in reality, lap to lap.
- **The grade is a low pass**, binned at 25 m and spline-smoothed, and vertical curvature is a
  second derivative of it. Peaks are flattened, as section 6 shows at Raidillon.
- **The elevation is relative shape, not survey.** z is height above the circuit's lowest point,
  from consumer-grade GPS altitude, median-binned.
- **Braking boards are placed, not surveyed.** See section 8.
- **Published `s_m` is planar arc length.** The solver derives 3D length internally; every quoted
  loop length and corner position is planar.
- **No tyre degradation, no fuel load, no traffic, no wind, no track temperature.**

## 10. Would a race engineer trust this?

They would trust the **deltas**, and not the **absolutes**.

The absolutes are a model of a car nobody measured, on a tyre with no slip angle, against a ggv
diagram that does not exist publicly. A lap time out of this to three decimal places is precision
without accuracy, and the interface says so in the line under it: *solved for a GT3 model at
μ1.40, not measured.*

The deltas hold, because the error is common to both sides of the subtraction:

- how much later you brake at μ1.40 than at μ1.20, corner by corner
- which corners are grip-limited and which are power-limited
- which braking zone moves most when grip changes
- which axle limits each corner, and how much the other one has spare
- how much a decomposition costs against a simultaneous solve, and that the cost grows as grip
  falls

Those survive the whole of section 9. They are also the questions a race engineer actually asks,
because the absolutes come from the car in the garage rather than from a model.
