// cumulative-time table over a lap: the shared arc-length <-> time mapping used by the car
// marker, the timeline scrubber, and the ghost car -- one implementation so they always
// agree on where the car is at time t.

export interface LapTimeTable {
  cumTimeS: Float64Array; // time to reach each line point from s=0
  lapTimeS: number;
}

export function buildLapTimeTable(sM: Float64Array, vMps: Float64Array): LapTimeTable {
  const n = sM.length;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const ds = sM[i] - sM[i - 1];
    cum[i] = cum[i - 1] + (2 * ds) / (vMps[i - 1] + vMps[i]);
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
