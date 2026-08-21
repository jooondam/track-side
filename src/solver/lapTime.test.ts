// hand-computed checks for the shared arc-length <-> time mapping.

import { describe, expect, it } from "vitest";
import { buildLapTimeTable, deltaToGhost, sAtTime, timeAtS } from "./lapTime";

describe("lapTime", () => {
  // 3 segments of 10 m at constant 10 m/s: 1 s per segment, 3 s lap
  const sM = Float64Array.from([0, 10, 20, 30]);
  const vMps = Float64Array.from([10, 10, 10, 10]);
  const table = buildLapTimeTable(sM, vMps);

  it("builds the cumulative table", () => {
    expect(table.lapTimeS).toBeCloseTo(3.0, 12);
    expect(Array.from(table.cumTimeS)).toEqual([0, 1, 2, 3]);
  });

  it("maps s to time and back", () => {
    expect(timeAtS(table, sM, 15)).toBeCloseTo(1.5, 12);
    expect(sAtTime(table, sM, 1.5)).toBeCloseTo(15, 12);
  });

  it("wraps time around the lap", () => {
    expect(sAtTime(table, sM, 3.5)).toBeCloseTo(5, 12);
    expect(sAtTime(table, sM, -0.5)).toBeCloseTo(25, 12);
  });

  it("handles varying speed", () => {
    // segment 0-10 at avg 10 m/s (1 s), 10-20 at avg 20 m/s (0.5 s)
    const v2 = Float64Array.from([10, 10, 30, 30]);
    const t2 = buildLapTimeTable(Float64Array.from([0, 10, 20]), v2.slice(0, 3));
    expect(t2.cumTimeS[1]).toBeCloseTo(1.0, 12);
    expect(t2.cumTimeS[2]).toBeCloseTo(1.5, 12);
  });
});

// the sign here is the whole point: it was written both ways round in four places, so it is
// pinned by a test rather than by a comment.
describe("deltaToGhost", () => {
  it("is negative when the car is quicker than its ghost", () => {
    expect(deltaToGhost(92.1, 93.4)).toBeCloseTo(-1.3, 12);
  });

  it("is positive when the car is slower", () => {
    expect(deltaToGhost(94.7, 93.4)).toBeCloseTo(1.3, 12);
  });

  it("is zero for a coincident ghost", () => {
    expect(deltaToGhost(93.4, 93.4)).toBe(0);
  });
});
