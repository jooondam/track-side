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
