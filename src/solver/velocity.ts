// forward-backward velocity profile solver: TypeScript port of offline/velocity/solver.py.
// cross-validated against the Python solver's output in velocity.test.ts (lap time within
// 0.1 s, v(s) pointwise within 0.1 m/s on both committed circuit fixtures): the port is
// trusted because it matches, not because it looks the same.
//
// designed for the grip slider's per-drag recompute: create a VelocitySolver once per
// circuit (allocates every working array), call solve(mu) as often as the slider moves --
// zero allocation per call, everything written into the preallocated buffers.

import type { GT3Vehicle } from "./vehicle";
import { axDragMps2, axEngineMps2, ayMaxMps2, vTopMps } from "./vehicle";

export const PHASE_ACCEL_THRESHOLD_G = 0.05;

export type Phase = 0 | 1 | 2; // 0 coast, 1 accel, 2 brake
export const PHASE_COAST: Phase = 0;
export const PHASE_ACCEL: Phase = 1;
export const PHASE_BRAKE: Phase = 2;

export interface VelocityProfileResult {
  vMps: Float64Array; // length n+1, closed-duplicate like the Python arrays
  axMps2: Float64Array;
  ayMps2: Float64Array;
  phase: Uint8Array;
  lapTimeS: number;
}

function axBudgetMps2(
  vehicle: GT3Vehicle,
  vMps: number,
  kappaAbs: number,
  brake: boolean,
): number {
  const ayMax = ayMaxMps2(vehicle, vMps);
  const ayUsed = vMps * vMps * kappaAbs;
  const ratio = ayMax > 0 ? ayUsed / ayMax : 1.0;
  const radicand = 1.0 - ratio * ratio;
  const axTires = radicand > 0 ? ayMax * Math.sqrt(radicand) : 0.0;
  const axDrag = axDragMps2(vehicle, vMps);
  if (brake) return axTires + axDrag; // braking is purely tire-limited, no engine term
  return Math.min(axTires, axEngineMps2(vehicle, vMps)) - axDrag;
}

function accelerationPhaseStarts(v: Float64Array, n: number, out: number[]): void {
  // indices where v steps upward with a gap from the previous upward step:
  // the start of each acceleration phase (port of _acceleration_phase_starts)
  out.length = 0;
  let prevUp = -2;
  for (let i = 0; i < n - 1; i++) {
    if (v[i + 1] - v[i] > 0) {
      if (i - prevUp > 1) out.push(i);
      prevUp = i;
    }
  }
}

export class VelocitySolver {
  private readonly n: number;
  private readonly kappaAbs: Float64Array;
  private readonly elLengths: Float64Array;
  private readonly vCap: Float64Array;
  private readonly vDouble: Float64Array;
  private readonly kappaDouble: Float64Array;
  private readonly elDouble: Float64Array;
  private readonly starts: number[] = [];
  private readonly scratch: Float64Array;
  readonly result: VelocityProfileResult;
  private readonly kappaSigned: Float64Array;

  constructor(sM: Float64Array | number[], kappa1pm: Float64Array | number[]) {
    // sM/kappa1pm are closed-duplicate (last point repeats the first), like the artifacts
    const nPoints = sM.length;
    this.n = nPoints - 1;
    this.kappaAbs = new Float64Array(this.n);
    this.elLengths = new Float64Array(this.n);
    this.kappaSigned = Float64Array.from(kappa1pm as ArrayLike<number>);
    for (let i = 0; i < this.n; i++) {
      this.kappaAbs[i] = Math.abs(this.kappaSigned[i]);
      this.elLengths[i] = (sM[i + 1] as number) - (sM[i] as number);
    }
    this.vCap = new Float64Array(this.n);
    this.vDouble = new Float64Array(2 * this.n);
    this.kappaDouble = new Float64Array(2 * this.n);
    this.elDouble = new Float64Array(2 * this.n);
    this.kappaDouble.set(this.kappaAbs, 0);
    this.kappaDouble.set(this.kappaAbs, this.n);
    this.elDouble.set(this.elLengths, 0);
    this.elDouble.set(this.elLengths, this.n);
    this.scratch = new Float64Array(2 * this.n);
    this.result = {
      vMps: new Float64Array(nPoints),
      axMps2: new Float64Array(nPoints),
      ayMps2: new Float64Array(nPoints),
      phase: new Uint8Array(nPoints),
      lapTimeS: 0,
    };
  }

  private integratePass(vehicle: GT3Vehicle, brake: boolean): void {
    // one forward accel or backward brake pass over the doubled lap, composed as
    // pointwise-minimum (port of _integrate_pass; the backward pass runs on reversed
    // views, expressed here with explicit index arithmetic instead of array flips)
    const n2 = 2 * this.n;
    const v = this.vDouble;
    const vTop = vTopMps(vehicle);

    const kappaAt = (i: number) => (brake ? this.kappaDouble[n2 - 1 - i] : this.kappaDouble[i]);
    const elAt = (i: number) => (brake ? this.elDouble[n2 - 1 - i] : this.elDouble[i]);
    const vAt = (i: number) => (brake ? v[n2 - 1 - i] : v[i]);
    const setV = (i: number, val: number) => {
      if (brake) v[n2 - 1 - i] = val;
      else v[i] = val;
    };

    // phase-start detection needs the (possibly reversed) profile as a contiguous array
    for (let i = 0; i < n2; i++) this.scratch[i] = vAt(i);
    accelerationPhaseStarts(this.scratch, n2, this.starts);

    while (this.starts.length > 0) {
      let i = this.starts.shift() as number;
      while (i < n2 - 1) {
        const ax = axBudgetMps2(vehicle, vAt(i), kappaAt(i), brake);
        let vNext = Math.sqrt(Math.max(vAt(i) * vAt(i) + 2 * ax * elAt(i), 0));

        if (brake) {
          // refine once: ax at i+1 differs from ax at i (radius, speed both change)
          const axNext = axBudgetMps2(vehicle, vNext, kappaAt(i + 1), brake);
          const vRefined = Math.sqrt(Math.max(vAt(i) * vAt(i) + 2 * axNext * elAt(i), 0));
          if (vRefined < vNext) vNext = vRefined;
        }

        if (vNext < vAt(i + 1)) setV(i + 1, vNext);

        i += 1;
        if (vNext > vTop || (this.starts.length > 0 && i >= this.starts[0])) break;
      }
    }
  }

  solve(vehicle: GT3Vehicle): VelocityProfileResult {
    const n = this.n;
    const vTop = vTopMps(vehicle);

    // closed-form lateral speed cap (port of lateral_speed_cap_mps)
    const downforceCoeff = 0.5 * vehicle.air_density_kgpm3 * vehicle.downforce_area_m2;
    for (let i = 0; i < n; i++) {
      const denom = vehicle.mass_kg * this.kappaAbs[i] - vehicle.mu * downforceCoeff;
      const cap =
        denom > 1e-9 ? Math.sqrt((vehicle.mu * vehicle.mass_kg * vehicle.g_mps2) / denom) : vTop;
      this.vCap[i] = Math.min(cap, vTop);
    }

    // double lap for the closed-loop periodic boundary condition (TUM's proven trick):
    // forward pass over two laps, keep the second, repeat for the backward pass
    this.vDouble.set(this.vCap, 0);
    this.vDouble.set(this.vCap, n);
    this.integratePass(vehicle, false);
    this.vDouble.copyWithin(0, n, 2 * n);
    this.vDouble.copyWithin(n, 0, n);
    this.integratePass(vehicle, true);

    const r = this.result;
    for (let i = 0; i < n; i++) r.vMps[i] = this.vDouble[n + i];
    r.vMps[n] = r.vMps[0];

    let lapTime = 0;
    const threshold = PHASE_ACCEL_THRESHOLD_G * vehicle.g_mps2;
    for (let i = 0; i < n; i++) {
      const ax = (r.vMps[i + 1] * r.vMps[i + 1] - r.vMps[i] * r.vMps[i]) / (2 * this.elLengths[i]);
      r.axMps2[i] = ax;
      lapTime += (2 * this.elLengths[i]) / (r.vMps[i] + r.vMps[i + 1]);
    }
    r.axMps2[n] = r.axMps2[0];
    for (let i = 0; i <= n; i++) {
      r.ayMps2[i] = r.vMps[i] * r.vMps[i] * this.kappaSigned[i];
      r.phase[i] =
        r.axMps2[i] > threshold ? PHASE_ACCEL : r.axMps2[i] < -threshold ? PHASE_BRAKE : PHASE_COAST;
    }
    r.lapTimeS = lapTime;
    return r;
  }
}
