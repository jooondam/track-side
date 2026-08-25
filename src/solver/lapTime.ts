// cumulative-time table over a lap: the shared arc-length <-> time mapping used by the car
// marker, the timeline scrubber, and the ghost car: one implementation so they always
// agree on where the car is at time t.

export interface LapTimeTable {
  cumTimeS: Float64Array; // time to reach each line point from s=0
  lapTimeS: number;
}

/**
 * dlM is the solver's 3D segment length. pass it whenever the circuit has elevation: the
 * planar ds understates the distance travelled by ~7 m at Spa, and integrating it here while
 * the solver integrates dl leaves the car marker drifting out of sync with the lap time the
 * HUD is showing. sAtTime and timeAtS still return planar s, which is what every consumer
 * (corner positions, the scrubber, the elevation strip) expects.
 */
export function buildLapTimeTable(
  sM: Float64Array,
  vMps: Float64Array,
  dlM?: Float64Array,
): LapTimeTable {
  const n = sM.length;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const dl = dlM ? dlM[i - 1] : sM[i] - sM[i - 1];
    cum[i] = cum[i - 1] + (2 * dl) / (vMps[i - 1] + vMps[i]);
  }
  return { cumTimeS: cum, lapTimeS: cum[n - 1] };
}

/** binary search: largest index i with table[i] <= value (table monotone non-decreasing). */
export function lowerIndex(table: Float64Array, value: number): number {
  let lo = 0;
  let hi = table.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid] <= value) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function timeAtS(table: LapTimeTable, sM: Float64Array, s: number): number {
  const lo = lowerIndex(sM, s);
  const hi = Math.min(lo + 1, sM.length - 1);
  const frac = (s - sM[lo]) / Math.max(sM[hi] - sM[lo], 1e-9);
  return table.cumTimeS[lo] + frac * (table.cumTimeS[hi] - table.cumTimeS[lo]);
}

export function sAtTime(table: LapTimeTable, sM: Float64Array, t: number): number {
  const wrapped = ((t % table.lapTimeS) + table.lapTimeS) % table.lapTimeS;
  const lo = lowerIndex(table.cumTimeS, wrapped);
  const hi = Math.min(lo + 1, sM.length - 1);
  const frac =
    (wrapped - table.cumTimeS[lo]) / Math.max(table.cumTimeS[hi] - table.cumTimeS[lo], 1e-9);
  return sM[lo] + frac * (sM[hi] - sM[lo]);
}

/**
 * The car's delta to its ghost at the same point on the road, in seconds.
 *
 * One convention for the whole interface: **car minus ghost, so negative means the car is
 * quicker**. That is the sign a delta bar shows a driver and the sign a time variance channel
 * shows an engineer, and agreeing with them matters more than any local convenience, because the
 * number in the rail and the trace in the dock are read together.
 *
 * This is a function rather than a subtraction written out at each site because it was written
 * both ways round in four places, two of them 300px apart on the same screen: the rail said the
 * car was slower while the dock said it was quicker, about one comparison. The arithmetic was
 * right in every one of them, which is exactly why it survived so long.
 */
export function deltaToGhost(carTimeS: number, ghostTimeS: number): number {
  return carTimeS - ghostTimeS;
}

/**
 * Advance the shared lap clock by one frame.
 *
 * **There used to be no clock at all.** Each car marker owned its own playback, carrying arc
 * length and reconstructing time from it every frame through its own table:
 *
 *     t = timeAtS(myTable, s); s = sAtTime(myTable, t + dt)
 *
 * That had two costs. `timeAtS` interpolates in s and `sAtTime` interpolates in t, so they are not
 * exact inverses and the round trip accumulated error in each marker independently. And because
 * `sAtTime` wraps modulo *its own* solve's lap time, two cars holding equal elapsed time wrapped
 * at different periods: the quicker ghost gained a whole lap every so often and the on-track gap
 * grew without bound. One clock, read by both, removes both problems.
 *
 * `lapTimeS` is the **live car's**, which is what makes this a rolling start: both cars re-zero
 * when the car being driven crosses the line, so the gap on screen is one lap's worth of grip cost
 * and never more. The ghost runs on past the line into a partial next lap before the reset, which
 * is what finishing ahead looks like.
 *
 * The frame clamp is the one from the old per-marker loop, kept for the same reason: a tab-switch
 * stall must not launch the car half a lap down the road.
 */
export const MAX_FRAME_S = 0.1;

export function advanceLapClock(
  tS: number,
  frameDeltaS: number,
  speedMultiplier: number,
  lapTimeS: number,
): number {
  if (!(lapTimeS > 0)) return 0;
  const next = tS + Math.min(frameDeltaS, MAX_FRAME_S) * speedMultiplier;
  return ((next % lapTimeS) + lapTimeS) % lapTimeS;
}

/**
 * The live delta to the ghost, **at the car's current point on the road**.
 *
 * Distance-aligned, not time-aligned, and that is the whole point: DeltaTrace's header puts it
 * best, comparing two cars at the same instant compares different pieces of road. Every readout in
 * the interface answers this same question at the same arc length, so they agree by construction.
 *
 * This exists because the number now appears in three places at once (the rail, the dock strip and
 * the tether in the scene) and the last time one comparison was written out at several sites they
 * disagreed in sign, two of them 300px apart. See deltaToGhost.
 */
export function liveDeltaToGhost(
  carTable: LapTimeTable,
  ghostTable: LapTimeTable,
  sM: Float64Array,
  s: number,
): number {
  return deltaToGhost(timeAtS(carTable, sM, s), timeAtS(ghostTable, sM, s));
}

/**
 * Signed on-track separation in metres, the shorter way round the loop.
 *
 * **This is a different quantity from the delta above and must never be presented as the same
 * one.** The delta is seconds at one point on the road; this is metres between two points at one
 * instant. Positive means the ghost is up the road, which matches the delta's sign convention:
 * positive is the car being behind.
 */
export function gapMetres(carS: number, ghostS: number, loopLengthM: number): number {
  const raw = ghostS - carS;
  const half = loopLengthM / 2;
  return ((((raw + half) % loopLengthM) + loopLengthM) % loopLengthM) - half;
}
