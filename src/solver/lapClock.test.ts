// the rolling start, pinned.
//
// The two cars used to run on independent clocks, each wrapping modulo its own lap time, so the
// quicker ghost gained a whole lap periodically and the on-track gap grew without bound. These
// tests exist to make that specific failure impossible to reintroduce: the bounded-gap case below
// is the property the whole change was made to establish.

import { describe, expect, it } from "vitest";
import {
  MAX_FRAME_S,
  advanceLapClock,
  buildLapTimeTable,
  gapMetres,
  liveDeltaToGhost,
  sAtTime,
} from "./lapTime";

// a 300 m loop. The car holds 10 m/s for a 30 s lap; the ghost holds 12 m/s for a 25 s lap, so it
// is a clear 5 s a lap quicker, which is a far bigger spread than a grip step gives and therefore
// a harsher test of the bound.
const sM = Float64Array.from([0, 100, 200, 300]);
const LOOP = 300;
const carTable = buildLapTimeTable(sM, Float64Array.from([10, 10, 10, 10]));
const ghostTable = buildLapTimeTable(sM, Float64Array.from([12, 12, 12, 12]));

const carAt = (t: number) => sAtTime(carTable, sM, t);
const ghostAt = (t: number) => sAtTime(ghostTable, sM, t);

describe("advanceLapClock", () => {
  it("advances by the frame time times the speed multiplier", () => {
    expect(advanceLapClock(0, 0.016, 1, 30)).toBeCloseTo(0.016, 12);
    expect(advanceLapClock(0, 0.016, 5, 30)).toBeCloseTo(0.08, 12);
  });

  it("clamps a stalled frame, so a tab switch cannot launch the car down the road", () => {
    // 4 s of wall clock at 10x would be 40 s of lap, most of a lap of teleport
    expect(advanceLapClock(0, 4, 10, 30)).toBeCloseTo(MAX_FRAME_S * 10, 12);
  });

  it("wraps at the lap time", () => {
    // note the frame is under MAX_FRAME_S: at 0.2 the clamp lands the clock exactly on the lap
    // boundary and the answer is 0, which tests the clamp rather than the wrap
    expect(advanceLapClock(29.95, 0.08, 1, 30)).toBeCloseTo(0.03, 12);
  });

  it("survives a degenerate lap time rather than returning NaN", () => {
    expect(advanceLapClock(5, 0.016, 1, 0)).toBe(0);
  });
});

describe("the rolling start", () => {
  it("puts both cars on the line at t = 0", () => {
    expect(carAt(0)).toBeCloseTo(0, 12);
    expect(ghostAt(0)).toBeCloseTo(0, 12);
  });

  it("keeps the quicker ghost up the road for the whole of the car's lap", () => {
    for (let t = 0.5; t < carTable.lapTimeS; t += 0.5) {
      const gap = gapMetres(carAt(t), ghostAt(t), LOOP);
      expect(gap, `ghost should lead at t=${t}`).toBeGreaterThan(0);
    }
  });

  it("re-zeros both cars when the car crosses the line, not when the ghost does", () => {
    // the ghost finishes its lap at 25 s and runs on into a partial second one
    expect(ghostAt(25)).toBeCloseTo(0, 9);
    expect(ghostAt(27)).toBeCloseTo(24, 9);
    expect(carAt(27)).toBeCloseTo(270, 9);
    // and at the car's lap time the shared clock wraps, putting both back on the line
    const wrapped = advanceLapClock(carTable.lapTimeS - 0.001, 0.001, 1, carTable.lapTimeS);
    expect(wrapped).toBeCloseTo(0, 9);
    expect(carAt(wrapped)).toBeCloseTo(0, 9);
    expect(ghostAt(wrapped)).toBeCloseTo(0, 9);
  });

  it("bounds the gap across many laps, which is the whole point", () => {
    // the old behaviour: independent clocks, each wrapping on its own lap time. Simulated here so
    // the regression is described rather than merely absent.
    let worstShared = 0;
    let worstIndependent = 0;
    let t = 0;
    for (let frame = 0; frame < 20_000; frame++) {
      t = advanceLapClock(t, 1 / 60, 10, carTable.lapTimeS);
      worstShared = Math.max(worstShared, Math.abs(gapMetres(carAt(t), ghostAt(t), LOOP)));

      // independent: elapsed time never wraps at a shared point, so each car wraps on its own
      const elapsed = (frame * 10) / 60;
      worstIndependent = Math.max(
        worstIndependent,
        Math.abs(gapMetres(carAt(elapsed), ghostAt(elapsed), LOOP)),
      );
    }
    // one lap's grip cost is 5 s, which at the ghost's 12 m/s is 60 m of road
    expect(worstShared).toBeLessThanOrEqual(LOOP / 2);
    expect(worstShared).toBeLessThan(70);
    // the old way reaches the far side of the circuit, which is the reported symptom
    expect(worstIndependent).toBeGreaterThan(LOOP / 2 - 1);
  });
});

describe("liveDeltaToGhost", () => {
  it("is distance-aligned, and negative only where the car is genuinely quicker", () => {
    // the car is slower everywhere here, so the delta is positive everywhere and grows with s
    expect(liveDeltaToGhost(carTable, ghostTable, sM, 0)).toBeCloseTo(0, 12);
    expect(liveDeltaToGhost(carTable, ghostTable, sM, 150)).toBeCloseTo(15 - 12.5, 9);
    expect(liveDeltaToGhost(carTable, ghostTable, sM, 300)).toBeCloseTo(5, 9);
  });

  it("is exactly zero against itself, at every point", () => {
    for (const s of [0, 37, 150, 299]) {
      expect(liveDeltaToGhost(carTable, carTable, sM, s)).toBe(0);
    }
  });
});

describe("gapMetres", () => {
  it("signs the gap so positive means the ghost is up the road", () => {
    expect(gapMetres(100, 160, LOOP)).toBeCloseTo(60, 12);
    expect(gapMetres(160, 100, LOOP)).toBeCloseTo(-60, 12);
  });

  it("takes the shorter way round rather than the long way", () => {
    // ghost just past the line, car just before it: 20 m ahead, not 280 m behind
    expect(gapMetres(290, 10, LOOP)).toBeCloseTo(20, 12);
    expect(gapMetres(10, 290, LOOP)).toBeCloseTo(-20, 12);
  });

  it("never exceeds half the loop, in either direction", () => {
    for (let a = 0; a < LOOP; a += 7) {
      for (let b = 0; b < LOOP; b += 11) {
        expect(Math.abs(gapMetres(a, b, LOOP))).toBeLessThanOrEqual(LOOP / 2 + 1e-9);
      }
    }
  });
});
