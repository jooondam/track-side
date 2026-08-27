// board-relative braking points: where the car first touches the brakes for each named corner,
// reported against the distance boards a driver actually sees from the cockpit.
//
// This is the one number in the project that transfers to driving the circuit, and it is also
// the one most exposed to the data behind it. The boards are hand-placed from circuit maps and
// broadcast footage, so "brake at the 100 board" carries the board's own error, roughly plus or
// minus 10 m, and the panel says so once in its header.
//
// The *shift between two grip levels* does not carry that error at all. Move mu and the boards
// stay exactly where they were, so the difference is exact whatever the true board position is.
// That is why `brakingShift` sits in this module beside `brakingPoints` rather than being left
// to the reader to subtract: it is the stronger claim of the two and it should be as easy to
// print.

import type { Board, Corner, LineData } from "../assets";
import { PHASE_BRAKE, type VelocityProfileResult } from "./velocity";

/**
 * a brake phase shorter than this is a lift, not a braking event. `phase` is a 0.05 g threshold
 * on ax, so a car easing over a crest or shedding speed into a kink crosses it for a few metres
 * without anything a driver would call a braking point.
 */
export const MIN_BRAKE_RUN_M = 10;

/**
 * two brake runs closer than this are one braking event with a release in the middle. Trail
 * braking dips under the same 0.05 g threshold without the driver coming off the pedal, and
 * reporting the second dip as the braking point would put it inside the corner.
 */
export const BRAKE_MERGE_GAP_M = 20;


export interface BrakingPoint {
  corner: Corner;
  /** arc length where the braking event begins, metres */
  sBrakeM: number;
  /** the board nearest that point, or null for a corner whose boards were not authored */
  board: Board | null;
  /** s_brake - board.s_m. Positive means the car brakes *after* the board, so deeper. */
  boardDeltaM: number | null;
  vEntryKph: number;
  brakingDistanceM: number;
  peakDecelG: number;
  /** which axle reaches its friction circle first at peak deceleration */
  limiting: "front" | "rear";
  /**
   * grip the *other* axle still has at that moment, as a fraction of its own circle.
   *
   * This is the column that turns a constant into a finding. With the shipped GT3 numbers, a
   * 62% front brake bias on a 44% front weight distribution, the front axle is on its circle at
   * every corner of both circuits at every grip the slider offers, and the rear is carrying
   * 19 to 42% it never uses. A real driver moves the bias back until that number shrinks.
   */
  spareGripFrac: number;
}

/** how far the braking point moves between two solves of the same circuit. */
export interface BrakingShift {
  corner: Corner;
  /** metres later than the reference. Negative is earlier, which is what less grip gives you. */
  shiftM: number;
  sBrakeM: number;
  referenceSBrakeM: number;
}

/** forward distance from a to b around the loop, always in [0, loop). */
function forward(a: number, b: number, loop: number): number {
  return (((b - a) % loop) + loop) % loop;
}

/** a - b as a signed distance around the loop, in [-loop/2, loop/2]. */
function signedGap(a: number, b: number, loop: number): number {
  const d = forward(b, a, loop);
  return d > loop / 2 ? d - loop : d;
}

type Run = [start: number, end: number]; // inclusive point indices, may wrap

/**
 * contiguous brake runs around the closed lap.
 *
 * The walk starts at a point that is not braking, so no run wraps in walk order and the joining
 * at the start line falls out instead of being a special case. A braking zone that begins before
 * s = 0 and ends after it is one event, and a lap that indexed it as two would report a braking
 * point at the start line.
 */
function brakeRuns(phase: Uint8Array, n: number): Run[] {
  let origin = 0;
  while (origin < n && phase[origin] === PHASE_BRAKE) origin++;
  if (origin === n) return []; // braking everywhere is not a lap

  const runs: Run[] = [];
  let open: Run | null = null;
  for (let k = 0; k < n; k++) {
    const i = (origin + k) % n;
    if (phase[i] === PHASE_BRAKE) {
      if (open === null) open = [i, i];
      else open[1] = i;
    } else if (open !== null) {
      runs.push(open);
      open = null;
    }
  }
  if (open !== null) runs.push(open);
  return runs;
}

/** merge runs closer than BRAKE_MERGE_GAP_M, including the pair straddling the start line. */
function mergeRuns(runs: Run[], sM: Float64Array, loop: number): Run[] {
  const out = runs.slice();
  let merged = true;
  while (merged && out.length > 1) {
    merged = false;
    for (let k = 0; k < out.length; k++) {
      const a = out[k];
      const nextK = (k + 1) % out.length;
      const b = out[nextK];
      if (forward(sM[a[1]], sM[b[0]], loop) < BRAKE_MERGE_GAP_M) {
        a[1] = b[1];
        out.splice(nextK, 1);
        merged = true;
        break;
      }
    }
  }
  return out;
}

/**
 * one row per corner that the car actually brakes for.
 *
 * A run is the braking event for a corner when the car is **still braking at turn-in**. That is
 * what a braking point is: the pedal goes down on the straight and comes up somewhere in the
 * corner, so the run has to contain the turn-in between its ends. Runs are disjoint by
 * construction, so at most one can, and the rule needs no distance window and no tie-break.
 *
 * It earns its place on both circuits. Braking *inside* Monza's first chicane, between its two
 * elements, is not the braking for Curva Grande 350 m later: it is released long before Curva
 * Grande turns in, and Curva Grande is taken flat. Braking for Curve Paul Frere is not the
 * braking for Blanchimont. And the rule keeps the case a simple "nearest corner ahead" gets
 * wrong in the other direction: Spa brakes for Raidillon from *before* Eau Rouge's apex,
 * because the two are 100 m apart and the car is hard on the pedal through the compression.
 *
 * One event belongs to one corner. Below mu 1.20 that same Spa run covers both turn-ins, and it
 * is Raidillon's: the later turn-in is the one the pedal is still down for, and Eau Rouge is
 * passed through under braking rather than braked for.
 */
export function brakingPoints(
  line: LineData,
  result: VelocityProfileResult,
  corners: Corner[],
): BrakingPoint[] {
  const loop = line.loopLengthM;
  const n = line.nPoints - 1; // the last point duplicates the first
  const sM = line.sM;

  const runs = mergeRuns(brakeRuns(result.phase, n), sM, loop).filter(
    (r) => forward(sM[r[0]], sM[r[1]], loop) >= MIN_BRAKE_RUN_M,
  );

  const claimed = new Map<string, Run>();
  for (const run of runs) {
    const reach = forward(sM[run[0]], sM[run[1]], loop);
    let owner: Corner | null = null;
    let ownerAt = -1;
    for (const corner of corners) {
      const at = forward(sM[run[0]], corner.turnInSM, loop);
      if (at <= reach && at > ownerAt) {
        owner = corner;
        ownerAt = at;
      }
    }
    if (owner !== null) claimed.set(owner.id, run);
  }

  const points: BrakingPoint[] = [];
  for (const corner of corners) {
    const run = claimed.get(corner.id);
    if (run === undefined) continue; // flat out through this one

    const sBrake = sM[run[0]];

    let board: Board | null = null;
    let boardDeltaM: number | null = null;
    for (const b of corner.boards) {
      const d = signedGap(sBrake, b.sM, loop);
      if (boardDeltaM === null || Math.abs(d) < Math.abs(boardDeltaM)) {
        board = b;
        boardDeltaM = d;
      }
    }

    // the limiting axle is read at peak deceleration rather than averaged: the axle that runs
    // out of grip at the hardest point of the stop is the one that sets the braking distance,
    // and the other axle's spare is read at the same instant so the pair is one moment in time.
    let peakIdx = run[0];
    let peakAx = 0;
    const steps = (run[1] - run[0] + n) % n;
    for (let j = 0; j <= steps; j++) {
      const i = (run[0] + j) % n;
      if (result.axMps2[i] < peakAx) {
        peakAx = result.axMps2[i];
        peakIdx = i;
      }
    }

    const utilFront = result.gripUtilFront[peakIdx];
    const utilRear = result.gripUtilRear[peakIdx];

    points.push({
      corner,
      sBrakeM: sBrake,
      board,
      boardDeltaM,
      vEntryKph: result.vMps[run[0]] * 3.6,
      brakingDistanceM: forward(sM[run[0]], sM[run[1]], loop),
      peakDecelG: -peakAx / 9.80665,
      limiting: utilFront >= utilRear ? "front" : "rear",
      spareGripFrac: Math.max(0, 1 - Math.min(utilFront, utilRear)),
    });
  }

  return points;
}

/**
 * how far each braking point moves against a reference solve.
 *
 * Corners only one of the two solves brakes for are dropped rather than reported as a huge
 * shift: at very high grip a slow corner can stop being a braking event at all, and "moved
 * 400 m" would be an artifact of that, not a distance anyone can drive to.
 */
export function brakingShift(
  points: BrakingPoint[],
  reference: BrakingPoint[],
  loopLengthM: number,
): BrakingShift[] {
  const ref = new Map(reference.map((p) => [p.corner.id, p]));
  const out: BrakingShift[] = [];
  for (const p of points) {
    const r = ref.get(p.corner.id);
    if (r === undefined) continue;
    out.push({
      corner: p.corner,
      shiftM: signedGap(p.sBrakeM, r.sBrakeM, loopLengthM),
      sBrakeM: p.sBrakeM,
      referenceSBrakeM: r.sBrakeM,
    });
  }
  return out;
}

/** the corner whose braking point moves most, which is the one worth printing as a sentence. */
export function largestShift(shifts: BrakingShift[]): BrakingShift | null {
  let best: BrakingShift | null = null;
  for (const s of shifts) {
    if (best === null || Math.abs(s.shiftM) > Math.abs(best.shiftM)) best = s;
  }
  return best;
}
