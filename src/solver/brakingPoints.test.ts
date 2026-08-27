// braking points: the run-to-corner rule on a hand-built lap, and the grip claim on a real one.

import { describe, expect, it } from "vitest";
import monzaLandmarks from "../../public/monza/landmarks.json";
import monzaFixture from "./testdata/velocity_fixture_monza.json";
import type { Corner, LineData } from "../assets";
import { brakingPoints, brakingShift, largestShift } from "./brakingPoints";
import { PHASE_ACCEL, PHASE_BRAKE, PHASE_COAST, VelocitySolver } from "./velocity";
import type { VelocityProfileResult } from "./velocity";

// a 1000 m loop at 5 m spacing. Everything the module reads is built here and nothing else is,
// so a failure names the arithmetic rather than a circuit.
const SPACING_M = 5;
const N = 200;
const LOOP_M = SPACING_M * N;

function line(): LineData {
  const sM = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) sM[i] = i * SPACING_M;
  return {
    positionYup: new Float32Array(0),
    sM,
    zM: new Float64Array(N + 1),
    kappa1pm: new Float64Array(N + 1),
    loopLengthM: LOOP_M,
    nPoints: N + 1,
  };
}

/** a profile braking exactly on the given inclusive index spans and coasting everywhere else. */
function profile(
  spans: Array<[number, number]>,
  opts: { frontUtil?: number } = {},
): VelocityProfileResult {
  const n = N + 1;
  const phase = new Uint8Array(n).fill(PHASE_COAST);
  const axMps2 = new Float64Array(n);
  const vMps = new Float64Array(n).fill(60);

  for (const [a, b] of spans) {
    const steps = (b - a + N) % N;
    for (let k = 0; k <= steps; k++) {
      const i = (a + k) % N;
      phase[i] = PHASE_BRAKE;
      axMps2[i] = -20;
    }
  }
  return {
    vMps,
    axMps2,
    ayMps2: new Float64Array(n),
    phase,
    lapTimeS: 60,
    gradeRad: new Float64Array(n),
    dlM: new Float64Array(n).fill(SPACING_M),
    fzFrontN: new Float64Array(n),
    fzRearN: new Float64Array(n),
    gripUtilFront: new Float64Array(n).fill(opts.frontUtil ?? 0.9),
    gripUtilRear: new Float64Array(n).fill(0.8),
  };
}

/** turns in at s = 500, apexes at 520, boards 100 m and 50 m out. */
function corner(over: Partial<Corner> = {}): Corner {
  return {
    id: "t1",
    number: 1,
    name: "Test",
    sM: 520,
    turnInSM: 500,
    boardSide: "right",
    boards: [
      { distanceM: 100, sM: 400 },
      { distanceM: 50, sM: 450 },
    ],
    ...over,
  };
}

describe("brakingPoints", () => {
  it("reports the point against the nearest board, positive for braking after it", () => {
    // on the brakes from s = 410, ten metres past the 100 board, still braking at turn-in
    const [p] = brakingPoints(line(), profile([[82, 102]]), [corner()]);
    expect(p.sBrakeM).toBe(410);
    expect(p.board?.distanceM).toBe(100);
    expect(p.boardDeltaM).toBeCloseTo(10, 9);
    expect(p.brakingDistanceM).toBeCloseTo(100, 9);
    expect(p.vEntryKph).toBeCloseTo(216, 9);
  });

  it("is negative when the car brakes before the board", () => {
    const [p] = brakingPoints(line(), profile([[78, 102]]), [corner()]);
    expect(p.boardDeltaM).toBeCloseTo(-10, 9);
  });

  it("treats a release inside the braking zone as one event", () => {
    // brake, one point of coast at s = 445, brake again: a trail-braking dip under the 0.05 g
    // phase threshold, not a second braking point
    const points = brakingPoints(line(), profile([[82, 88], [90, 102]]), [corner()]);
    expect(points).toHaveLength(1);
    expect(points[0].sBrakeM).toBe(410);
  });

  it("ignores a lift too short to be a braking event", () => {
    const points = brakingPoints(line(), profile([[40, 41], [82, 102]]), [corner()]);
    expect(points).toHaveLength(1);
    expect(points[0].sBrakeM).toBe(410);
  });

  it("does not read braking that is released before turn-in as braking for the corner", () => {
    // Monza's chicane brakes between its own two elements, 350 m before Curva Grande, which is
    // taken flat. The nearest brake run ahead of that corner is not its braking point.
    expect(brakingPoints(line(), profile([[40, 60]]), [corner()])).toEqual([]);
  });

  it("gives a run that covers two turn-ins to the later corner", () => {
    // Spa below mu 1.20: one pedal application covers Eau Rouge and Raidillon, and it is
    // Raidillon's, because that is the corner the car is still braking for
    const first = corner({ id: "a", name: "First", sM: 470, turnInSM: 450 });
    const second = corner({ id: "b", name: "Second", sM: 520, turnInSM: 500 });
    const points = brakingPoints(line(), profile([[82, 102]]), [first, second]);
    expect(points.map((p) => p.corner.id)).toEqual(["b"]);
  });

  it("leaves a flat-out corner out of the report", () => {
    expect(brakingPoints(line(), profile([]), [corner()])).toEqual([]);
  });

  it("joins a braking zone that crosses the start line", () => {
    // on the brakes from s = 975 through s = 25, into a corner that turns in at s = 20
    const c = corner({ sM: 40, turnInSM: 20, boards: [{ distanceM: 100, sM: 900 }] });
    const [p] = brakingPoints(line(), profile([[195, 5]]), [c]);
    expect(p.sBrakeM).toBe(975);
    expect(p.brakingDistanceM).toBeCloseTo(50, 9);
    expect(p.boardDeltaM).toBeCloseTo(75, 9);
  });

  it("names the axle at its friction circle first, and what the other one has left", () => {
    // the synthetic profile holds the rear at 0.80 throughout
    const [front] = brakingPoints(line(), profile([[82, 102]], { frontUtil: 0.95 }), [corner()]);
    expect(front.limiting).toBe("front");
    expect(front.spareGripFrac).toBeCloseTo(0.2, 9);

    const [rear] = brakingPoints(line(), profile([[82, 102]], { frontUtil: 0.6 }), [corner()]);
    expect(rear.limiting).toBe("rear");
    expect(rear.spareGripFrac).toBeCloseTo(0.4, 9);
  });

  it("carries no board for a corner whose boards were never authored", () => {
    const [p] = brakingPoints(line(), profile([[82, 102]]), [corner({ boards: [] })]);
    expect(p.board).toBeNull();
    expect(p.boardDeltaM).toBeNull();
  });

  it("reads the brake phase and not any other", () => {
    const accelerating = profile([]);
    accelerating.phase.fill(PHASE_ACCEL);
    expect(brakingPoints(line(), accelerating, [corner()])).toEqual([]);
  });
});

describe("brakingShift", () => {
  it("is positive when the car brakes later than its reference", () => {
    const c = corner();
    const car = brakingPoints(line(), profile([[84, 102]]), [c]); // s = 420
    const ref = brakingPoints(line(), profile([[80, 102]]), [c]); // s = 400
    const [shift] = brakingShift(car, ref, LOOP_M);
    expect(shift.shiftM).toBeCloseTo(20, 9);
    expect(largestShift([shift])?.corner.id).toBe("t1");
  });

  it("drops a corner only one of the two solves brakes for", () => {
    const c = corner();
    const car = brakingPoints(line(), profile([]), [c]);
    const ref = brakingPoints(line(), profile([[80, 102]]), [c]);
    expect(brakingShift(car, ref, LOOP_M)).toEqual([]);
  });

  it("has nothing to print when nothing moved", () => {
    expect(largestShift([])).toBeNull();
  });
});

// the claim the panel makes in words, measured on the circuit it ships. The boards carry their
// own placement error and this says nothing about it: it is the shift between two solves over
// one set of boards, which is exact whatever the boards' true positions are.
describe("Monza, grip against braking point", () => {
  const corners: Corner[] = monzaLandmarks.corners.map((c) => ({
    id: c.id,
    number: c.number,
    name: c.name,
    sM: c.s_m,
    turnInSM: c.turn_in_s_m,
    boardSide: c.board_side as "left" | "right",
    boards: c.boards.map((b) => ({ distanceM: b.distance_m, sM: b.s_m })),
  }));

  const sM = Float64Array.from(monzaFixture.s_m);
  const l: LineData = {
    positionYup: new Float32Array(0),
    sM,
    zM: Float64Array.from(monzaFixture.z_m),
    kappa1pm: Float64Array.from(monzaFixture.kappa_1pm),
    loopLengthM: sM[sM.length - 1],
    nPoints: sM.length,
  };

  const vehicle = {
    mass_kg: 1300.0,
    downforce_area_m2: 2.8,
    drag_area_m2: 1.35,
    power_w: 410_000.0,
    air_density_kgpm3: 1.225,
    g_mps2: 9.81,
    v_floor_mps: 2.0,
    wheelbase_m: 2.65,
    cg_height_m: 0.3,
    weight_dist_front: 0.44,
    brake_bias_front: 0.62,
    tyre_load_sensitivity: 0.1,
    aero_balance_front: 0.45,
    fz_floor_frac: 0.02,
    drive_axle: "rear" as const,
  };

  const solve = (mu: number) =>
    brakingPoints(l, new VelocitySolver(l.sM, l.kappa1pm, l.zM).solve({ ...vehicle, mu }), corners);

  const grippy = solve(1.4);
  const reference = solve(1.2);

  it("brakes for every corner except the one that is taken flat", () => {
    // Curva Grande is a 291 m radius the car carries full speed through at every grip level the
    // slider offers, so it has no braking point rather than a wrong one
    expect(grippy.map((p) => p.corner.name)).toEqual([
      "Variante del Rettifilo",
      "Variante della Roggia",
      "Lesmo 1",
      "Lesmo 2",
      "Variante Ascari",
      "Parabolica",
    ]);
  });

  it("puts every braking point on the approach to its corner", () => {
    for (const p of grippy) {
      const ahead =
        (((p.corner.turnInSM - p.sBrakeM) % l.loopLengthM) + l.loopLengthM) % l.loopLengthM;
      expect(ahead).toBeGreaterThan(0);
      expect(ahead).toBeLessThan(250);
      expect(p.peakDecelG).toBeGreaterThan(1.0);
      expect(Math.abs(p.boardDeltaM!)).toBeLessThan(60);
    }
  });

  it("comes out front limited everywhere, with the rear never using what it has", () => {
    // not a coincidence and not a bug: a 62% front brake bias on a 44% front weight
    // distribution puts the front axle on its circle first at every corner. The spare is the
    // argument for moving the bias back, and it is why the report prints it
    for (const p of grippy) {
      expect(p.limiting).toBe("front");
      expect(p.spareGripFrac).toBeGreaterThan(0.15);
    }
  });

  it("brakes later everywhere with more grip", () => {
    const shifts = brakingShift(grippy, reference, l.loopLengthM);
    expect(shifts).toHaveLength(grippy.length);
    for (const s of shifts) expect(s.shiftM).toBeGreaterThan(0);
  });

  it("moves the biggest braking zone by a distance a driver could act on", () => {
    const biggest = largestShift(brakingShift(grippy, reference, l.loopLengthM));
    expect(biggest!.shiftM).toBeGreaterThan(20);
  });
});
