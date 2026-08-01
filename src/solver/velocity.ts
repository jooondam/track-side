// forward-backward velocity profile solver: TypeScript port of offline/velocity/solver.py.
// cross-validated against the Python solver's output in velocity.test.ts (lap time within
// 0.1 s, v(s) pointwise within 0.1 m/s, axle loads within 5 N on both committed circuit
// fixtures): the port is trusted because it matches, not because it looks the same.
//
// designed for the grip slider's per-drag recompute: create a VelocitySolver once per
// circuit (allocates every working array and every road-geometry channel), call solve(mu) as
// often as the slider moves: zero allocation per call, everything written into the
// preallocated buffers.
//
// M8 put the road's shape into the physics. every segment carries a grade angle and a
// vertical curvature derived from the elevation the viewer already draws, both passes carry
// a g*sin(theta) term, and the integration step uses the 3D segment length. ay_max is no
// longer closed form, so the lateral speed cap and the longitudinal budget are both fixed
// points now. see src/solver/vehicle.ts for the load model.

import type { AxleState, GT3Vehicle, VehicleConstants } from "./vehicle";
import {
  CAP_ITERS,
  LOAD_TRANSFER_ITERS,
  axDragMps2,
  axEngineMps2,
  axleState,
  newAxleState,
  vehicleConstants,
} from "./vehicle";

export const PHASE_ACCEL_THRESHOLD_G = 0.05;

// must match KAPPA_V_SMOOTH_WINDOW_M in offline/velocity/solver.py
export const KAPPA_V_SMOOTH_WINDOW_M = 25.0;

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
  // M8 channels, same closed-duplicate shape
  gradeRad: Float64Array;
  dlM: Float64Array;
  fzFrontN: Float64Array;
  fzRearN: Float64Array;
  gripUtilFront: Float64Array;
  gripUtilRear: Float64Array;
}

/**
 * one forward accel or backward brake budget at a point, resolving the implicit Fz(ax)
 * coupling by fixed point.
 *
 * seeded at zero transfer and iterated LOAD_TRANSFER_ITERS times. the contraction factor
 * through the transfer path is (1-k)*mu*h_cg/wheelbase, about 0.12 for GT3 numbers, so three
 * passes leave roughly 0.2% residual: well inside the 0.1 m/s cross-validation tolerance and
 * measured rather than assumed (offline/velocity/test_loads.py).
 */
function axBudgetMps2(
  c: VehicleConstants,
  scratch: AxleState,
  vMps: number,
  kappaAbs: number,
  brake: boolean,
  sinTheta: number,
  cosTheta: number,
  kappaV: number,
): number {
  const fyNeeded = c.mass * vMps * vMps * kappaAbs;
  const axDrag = axDragMps2(c, vMps);
  const axGrade = c.g * sinTheta;
  const axEngine = axEngineMps2(c, vMps);

  let axTyre = 0; // seed: no load transfer
  for (let iter = 0; iter < LOAD_TRANSFER_ITERS; iter++) {
    axleState(c, scratch, vMps, axTyre, cosTheta, kappaV);
    const gf = scratch.gripFront;
    const gr = scratch.gripRear;
    const total = gf + gr;

    // lateral demand split in proportion to axle grip capacity (the "balanced car"
    // assumption). with that split the two per-axle circles collapse exactly onto the single
    // lumped circle whenever brake bias matches the load split, so this is a strict
    // generalisation of the pre-M8 model rather than a different one.
    const ratio = total > 0 ? fyNeeded / total : 1;
    const radicand = 1 - ratio * ratio;
    const shrink = radicand > 0 ? Math.sqrt(radicand) : 0;
    const fxFront = gf * shrink;
    const fxRear = gr * shrink;

    if (brake) {
      const bias = c.brakeBiasFront;
      const axBrake = Math.min(fxFront / bias, fxRear / (1 - bias)) / c.mass;
      // the transfer must see the true signed accel. drop this negation and the car loads its
      // rear axle under braking, which produces a car that brakes better the harder it brakes.
      axTyre = -axBrake;
    } else {
      const axTraction = (c.driveRear ? fxRear : fxFront) / c.mass;
      axTyre = Math.min(axTraction, axEngine);
    }
  }

  if (brake) {
    // returned as a positive magnitude, because the backward pass integrates in the reversed
    // travel direction. gravity on an uphill helps you slow so it adds; on a downhill
    // sinTheta is already negative. there is no extra sign flip in the reversed indexing.
    return -axTyre + axDrag + axGrade;
  }
  return axTyre - axDrag - axGrade;
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
  private readonly kappaSigned: Float64Array;
  private readonly sinTheta: Float64Array;
  private readonly cosTheta: Float64Array;
  private readonly dl: Float64Array;
  private readonly kappaV: Float64Array;
  private readonly vCap: Float64Array;
  private readonly vDouble: Float64Array;
  private readonly kappaDouble: Float64Array;
  private readonly dlDouble: Float64Array;
  private readonly sinDouble: Float64Array;
  private readonly cosDouble: Float64Array;
  private readonly kappaVDouble: Float64Array;
  private readonly starts: number[] = [];
  private readonly scratch: Float64Array;
  private readonly axle: AxleState = newAxleState();
  readonly result: VelocityProfileResult;

  /**
   * sM/kappa1pm/zM are closed-duplicate (last point repeats the first), like the artifacts.
   * zM is optional: omit it and the circuit is flat, which is what every pre-M8 caller meant.
   */
  constructor(
    sM: Float64Array | number[],
    kappa1pm: Float64Array | number[],
    zM?: Float64Array | number[],
  ) {
    const nPoints = sM.length;
    this.n = nPoints - 1;
    const n = this.n;

    this.kappaAbs = new Float64Array(n);
    this.kappaSigned = Float64Array.from(kappa1pm as ArrayLike<number>);
    this.sinTheta = new Float64Array(n);
    this.cosTheta = new Float64Array(n);
    this.dl = new Float64Array(n);
    this.kappaV = new Float64Array(n);

    const theta = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.kappaAbs[i] = Math.abs(this.kappaSigned[i]);
      const ds = (sM[i + 1] as number) - (sM[i] as number);
      const dz = zM ? (zM[i + 1] as number) - (zM[i] as number) : 0;
      const dl = Math.hypot(ds, dz);
      this.dl[i] = dl;
      // sin(theta)*dl == dz identically, which is what makes the gravity term integrate to
      // exactly zero around the lap. theta is deliberately not smoothed for that reason.
      this.sinTheta[i] = dz / dl;
      this.cosTheta[i] = ds / dl;
      theta[i] = Math.atan2(dz, ds);
    }

    // vertical curvature d(theta)/ds, central difference around the closed loop, then a
    // circular boxcar. it is a second derivative of an already smoothed profile, so without
    // the averaging it is dominated by resampling noise.
    const meanDs = ((sM[n] as number) - (sM[0] as number)) / n;
    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const prev = (i - 1 + n) % n;
      const ds = (sM[i + 1] as number) - (sM[i] as number);
      const dsNext = (sM[next + 1] as number) - (sM[next] as number);
      const dsPrev = (sM[prev + 1] as number) - (sM[prev] as number);
      raw[i] = (theta[next] - theta[prev]) / (ds + 0.5 * (dsNext + dsPrev));
    }
    let window = Math.max(1, Math.round(KAPPA_V_SMOOTH_WINDOW_M / meanDs));
    if (window % 2 === 0) window += 1;
    const half = (window - 1) / 2;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let d = -half; d <= half; d++) sum += raw[(i + d + n * (half + 1)) % n];
      this.kappaV[i] = sum / window;
    }

    this.vCap = new Float64Array(n);
    this.vDouble = new Float64Array(2 * n);
    this.scratch = new Float64Array(2 * n);

    const double = (src: Float64Array): Float64Array => {
      const out = new Float64Array(2 * n);
      out.set(src, 0);
      out.set(src, n);
      return out;
    };
    this.kappaDouble = double(this.kappaAbs);
    this.dlDouble = double(this.dl);
    this.sinDouble = double(this.sinTheta);
    this.cosDouble = double(this.cosTheta);
    this.kappaVDouble = double(this.kappaV);

    const closed = (src: Float64Array): Float64Array => {
      const out = new Float64Array(nPoints);
      out.set(src, 0);
      out[n] = src[0];
      return out;
    };
    this.result = {
      vMps: new Float64Array(nPoints),
      axMps2: new Float64Array(nPoints),
      ayMps2: new Float64Array(nPoints),
      phase: new Uint8Array(nPoints),
      lapTimeS: 0,
      gradeRad: closed(Float64Array.from(this.sinTheta, Math.asin)),
      dlM: closed(this.dl),
      fzFrontN: new Float64Array(nPoints),
      fzRearN: new Float64Array(nPoints),
      gripUtilFront: new Float64Array(nPoints),
      gripUtilRear: new Float64Array(nPoints),
    };
  }

  private integratePass(c: VehicleConstants, brake: boolean): void {
    // one forward accel or backward brake pass over the doubled lap, composed as
    // pointwise-minimum (port of _integrate_pass; the backward pass runs on reversed
    // views, expressed here with explicit index arithmetic instead of array flips)
    const n2 = 2 * this.n;
    const v = this.vDouble;
    const vTop = c.vTop;
    const axle = this.axle;

    const rev = (i: number) => (brake ? n2 - 1 - i : i);
    const vAt = (i: number) => v[rev(i)];
    const setV = (i: number, val: number) => {
      v[rev(i)] = val;
    };
    const budget = (i: number, speed: number) =>
      axBudgetMps2(
        c,
        axle,
        speed,
        this.kappaDouble[rev(i)],
        brake,
        this.sinDouble[rev(i)],
        this.cosDouble[rev(i)],
        this.kappaVDouble[rev(i)],
      );

    // phase-start detection needs the (possibly reversed) profile as a contiguous array
    for (let i = 0; i < n2; i++) this.scratch[i] = vAt(i);
    accelerationPhaseStarts(this.scratch, n2, this.starts);

    while (this.starts.length > 0) {
      let i = this.starts.shift() as number;
      while (i < n2 - 1) {
        const dl = this.dlDouble[rev(i)];
        const ax = budget(i, vAt(i));
        let vNext = Math.sqrt(Math.max(vAt(i) * vAt(i) + 2 * ax * dl, 0));

        if (brake) {
          // refine once: ax at i+1 differs from ax at i (radius, speed, grade all change)
          const axNext = budget(i + 1, vNext);
          const vRefined = Math.sqrt(Math.max(vAt(i) * vAt(i) + 2 * axNext * dl, 0));
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
    const c = vehicleConstants(vehicle);
    const vTop = c.vTop;
    const axle = this.axle;

    // lateral speed cap: fixed point on v, seeded from the pre-M8 closed form. load
    // sensitivity makes Fz^(1-k) non-quadratic in v^2 so the closed form is only a seed now,
    // but it also removes the old degenerate case: grip grows like v^1.8 rather than v^2, so
    // a finite root always exists and no corner is ever aero-unlimited.
    const downforceCoeff = c.downforceCoeff;
    for (let i = 0; i < n; i++) {
      const kappaAbs = this.kappaAbs[i];
      const denom = c.mass * kappaAbs - vehicle.mu * downforceCoeff;
      let v = denom > 1e-9 ? Math.sqrt((vehicle.mu * c.mass * c.g) / denom) : vTop;
      if (v > vTop) v = vTop;

      const kappaSafe = Math.max(kappaAbs, 1e-12);
      for (let iter = 0; iter < CAP_ITERS; iter++) {
        // ax_tyre = 0 here is not an approximation: a car at the cornering limit has no spare
        // longitudinal tyre force, and by the Jensen argument that case maximises total grip,
        // so this stays a rigorous upper bound.
        axleState(c, axle, v, 0, this.cosTheta[i], this.kappaV[i]);
        v = Math.sqrt((axle.gripFront + axle.gripRear) / (c.mass * kappaSafe));
        if (v > vTop) v = vTop;
      }
      this.vCap[i] = v;
    }

    // double lap for the closed-loop periodic boundary condition (TUM's proven trick):
    // forward pass over two laps, keep the second, repeat for the backward pass
    this.vDouble.set(this.vCap, 0);
    this.vDouble.set(this.vCap, n);
    this.integratePass(c, false);
    this.vDouble.copyWithin(0, n, 2 * n);
    this.vDouble.copyWithin(n, 0, n);
    this.integratePass(c, true);

    const r = this.result;
    for (let i = 0; i < n; i++) r.vMps[i] = this.vDouble[n + i];
    r.vMps[n] = r.vMps[0];

    let lapTime = 0;
    const threshold = PHASE_ACCEL_THRESHOLD_G * c.g;
    for (let i = 0; i < n; i++) {
      const dl = this.dl[i];
      r.axMps2[i] = (r.vMps[i + 1] * r.vMps[i + 1] - r.vMps[i] * r.vMps[i]) / (2 * dl);
      lapTime += (2 * dl) / (r.vMps[i] + r.vMps[i + 1]);
    }
    r.axMps2[n] = r.axMps2[0];

    const bias = c.brakeBiasFront;
    for (let i = 0; i <= n; i++) {
      const v = r.vMps[i];
      const ax = r.axMps2[i];
      r.ayMps2[i] = v * v * this.kappaSigned[i];
      r.phase[i] =
        ax > threshold ? PHASE_ACCEL : ax < -threshold ? PHASE_BRAKE : PHASE_COAST;

      // axle diagnostics on the solved profile. the tyres must supply the net acceleration
      // plus everything resisting it, so ax_tyre adds back drag and gravity along the road.
      const seg = i === n ? 0 : i;
      const sinT = this.sinTheta[seg];
      const axTyre = ax + axDragMps2(c, v) + c.g * sinT;
      axleState(c, axle, v, axTyre, this.cosTheta[seg], this.kappaV[seg]);
      r.fzFrontN[i] = axle.fzFront;
      r.fzRearN[i] = axle.fzRear;

      const total = axle.gripFront + axle.gripRear;
      const fyNeeded = c.mass * v * v * Math.abs(this.kappaSigned[i]);
      const shareFront = axle.gripFront / total;
      const fyFront = fyNeeded * shareFront;
      const fyRear = fyNeeded * (1 - shareFront);
      const fxTotal = c.mass * axTyre;
      const driving = fxTotal >= 0;
      const fxFront = driving ? (c.driveRear ? 0 : fxTotal) : bias * fxTotal;
      const fxRear = driving ? (c.driveRear ? fxTotal : 0) : (1 - bias) * fxTotal;
      r.gripUtilFront[i] = Math.hypot(fxFront, fyFront) / axle.gripFront;
      r.gripUtilRear[i] = Math.hypot(fxRear, fyRear) / axle.gripRear;
    }

    r.lapTimeS = lapTime;
    // return a fresh wrapper object per solve (arrays still shared and mutated in place):
    // React dependency arrays key on the result's identity, and returning the same object
    // every call made [result] effects silently skip re-running on slider changes: colours,
    // braking markers, and lap tables all froze on the first solve's output
    return { ...r, lapTimeS: lapTime };
  }
}
