// GT3 two-axle vehicle model: TypeScript mirror of offline/velocity/vehicle.py.
// parameter values are never hardcoded here; they load from public/<circuit>/vehicle.json,
// which offline/build_viewer_assets.py exports from the Python dataclass: one source of
// truth for physics constants. Only mu is varied at runtime (the grip slider).
//
// see the Python module for the derivation. the short version:
//   Fz_norm  = m*(g*cos(theta) + v^2*kappa_v)     weight on a graded road plus the vertical
//                                                 curvature term
//   Fd       = 0.5*rho*ClA*v^2                    downforce, normal to the road plane
//   dFz      = m*ax_tyre*h_cg/wheelbase           longitudinal transfer, driven by the tyre's
//                                                 own longitudinal force, not the net accel
//   mu_axle  = mu*(Fz/Fz0)^-k                     load sensitivity, Fz0 the static axle load
//
// the Fz0 reference is a calibration invariant: at rest on the level with no aero, Fz == Fz0
// exactly, so ay_max(0) == mu*g exactly and the grip slider means what it always meant.

// fixed-point iteration counts. these must match LOAD_TRANSFER_ITERS and CAP_ITERS in
// offline/velocity/vehicle.py exactly or the two solvers diverge. velocity.test.ts asserts
// they equal the values the fixture generator recorded in its meta block.
//
// four, not three: braking divides the front axle's capacity by brake_bias_front, which lifts
// the fixed point's loop gain from ~0.12 to ~0.20 and leaves 0.8% after three passes. see the
// Python module for the measurement.
export const LOAD_TRANSFER_ITERS = 4;
export const CAP_ITERS = 5;

export interface GT3Vehicle {
  mass_kg: number;
  mu: number;
  downforce_area_m2: number;
  drag_area_m2: number;
  power_w: number;
  air_density_kgpm3: number;
  g_mps2: number;
  v_floor_mps: number;
  wheelbase_m: number;
  cg_height_m: number;
  weight_dist_front: number;
  brake_bias_front: number;
  tyre_load_sensitivity: number;
  aero_balance_front: number;
  fz_floor_frac: number;
  drive_axle: string;
}

/** everything the inner loop needs, derived once per solve so it costs nothing per point. */
export interface VehicleConstants {
  mass: number;
  g: number;
  vFloor: number;
  power: number;
  downforceCoeff: number;
  dragCoeff: number;
  transferCoeff: number;
  weightDistFront: number;
  aeroBalanceFront: number;
  brakeBiasFront: number;
  gripExponent: number; // 1 - k
  gripCoeffFront: number; // mu*Fz0_front^k
  gripCoeffRear: number; // mu*Fz0_rear^k
  fzFloor: number;
  driveRear: boolean;
  vTop: number;
}

export function vehicleConstants(v: GT3Vehicle): VehicleConstants {
  const weight = v.mass_kg * v.g_mps2;
  const fz0Front = v.weight_dist_front * weight;
  const fz0Rear = (1 - v.weight_dist_front) * weight;
  const k = v.tyre_load_sensitivity;
  const dragCoeff = 0.5 * v.air_density_kgpm3 * v.drag_area_m2;
  return {
    mass: v.mass_kg,
    g: v.g_mps2,
    vFloor: v.v_floor_mps,
    power: v.power_w,
    downforceCoeff: 0.5 * v.air_density_kgpm3 * v.downforce_area_m2,
    dragCoeff,
    transferCoeff: (v.mass_kg * v.cg_height_m) / v.wheelbase_m,
    weightDistFront: v.weight_dist_front,
    aeroBalanceFront: v.aero_balance_front,
    brakeBiasFront: v.brake_bias_front,
    gripExponent: 1 - k,
    // hoisting mu*Fz0^k out of the inner loop leaves one Math.pow per axle instead of a pow,
    // a divide and a multiply. that factorisation is most of what keeps the solve inside a
    // frame once the load model runs three times per budget evaluation.
    gripCoeffFront: v.mu * Math.pow(fz0Front, k),
    gripCoeffRear: v.mu * Math.pow(fz0Rear, k),
    fzFloor: v.fz_floor_frac * weight,
    driveRear: v.drive_axle !== "front",
    vTop: Math.cbrt(v.power_w / dragCoeff),
  };
}

export function axDragMps2(c: VehicleConstants, vMps: number): number {
  return (c.dragCoeff * vMps * vMps) / c.mass;
}

export function axEngineMps2(c: VehicleConstants, vMps: number): number {
  return c.power / (c.mass * Math.max(vMps, c.vFloor));
}

export function vTopMps(c: VehicleConstants): number {
  return c.vTop;
}

/** scratch record for the axle state, reused so the inner loop allocates nothing. */
export interface AxleState {
  fzFront: number;
  fzRear: number;
  gripFront: number;
  gripRear: number;
}

export function axleState(
  c: VehicleConstants,
  out: AxleState,
  vMps: number,
  axTyre: number,
  cosTheta: number,
  kappaV: number,
): void {
  const v2 = vMps * vMps;
  const fzNorm = c.mass * (c.g * cosTheta + v2 * kappaV);
  const fd = c.downforceCoeff * v2;
  const dFz = c.transferCoeff * axTyre;

  let fzFront = c.weightDistFront * fzNorm - dFz + c.aeroBalanceFront * fd;
  let fzRear = (1 - c.weightDistFront) * fzNorm + dFz + (1 - c.aeroBalanceFront) * fd;
  if (fzFront < c.fzFloor) fzFront = c.fzFloor;
  if (fzRear < c.fzFloor) fzRear = c.fzFloor;

  out.fzFront = fzFront;
  out.fzRear = fzRear;
  out.gripFront = c.gripCoeffFront * Math.pow(fzFront, c.gripExponent);
  out.gripRear = c.gripCoeffRear * Math.pow(fzRear, c.gripExponent);
}

export function newAxleState(): AxleState {
  return { fzFront: 0, fzRear: 0, gripFront: 0, gripRear: 0 };
}

/**
 * max lateral accel with no longitudinal tyre force left over.
 *
 * maximal at axTyre == 0: Fz^(1-k) is concave and load transfer conserves the total, so by
 * Jensen any transfer strictly reduces gripFront + gripRear. that is what makes the lateral
 * speed cap a rigorous upper bound rather than an estimate.
 */
export function ayMaxMps2(
  c: VehicleConstants,
  scratch: AxleState,
  vMps: number,
  axTyre = 0,
  cosTheta = 1,
  kappaV = 0,
): number {
  axleState(c, scratch, vMps, axTyre, cosTheta, kappaV);
  return (scratch.gripFront + scratch.gripRear) / c.mass;
}
