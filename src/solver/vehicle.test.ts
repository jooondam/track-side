// the M8 load model, pinned at specified accelerations.
//
// velocity.test.ts compares the whole solve against the Python fixtures, but it evaluates the
// axle loads at a finite-difference ax, which carries enough noise to hide a small error. this
// file has no such noise: every case fixes ax by hand, so a sign error or a dropped term shows
// up as a hard failure rather than as a widened tolerance. mirrors
// offline/velocity/test_vehicle.py.

import { describe, expect, it } from "vitest";
import type { GT3Vehicle } from "./vehicle";
import { axleState, ayMaxMps2, newAxleState, vehicleConstants } from "./vehicle";

const V: GT3Vehicle = {
  mass_kg: 1300.0,
  mu: 1.2,
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
  drive_axle: "rear",
};

const C = vehicleConstants(V);
const WEIGHT = V.mass_kg * V.g_mps2;

function loads(vMps: number, axTyre: number, cosTheta = 1, kappaV = 0) {
  const s = newAxleState();
  axleState(C, s, vMps, axTyre, cosTheta, kappaV);
  return s;
}

describe("axle loads", () => {
  it("splits the static weight by the weight distribution at rest", () => {
    const s = loads(0, 0);
    expect(s.fzFront).toBeCloseTo(V.weight_dist_front * WEIGHT, 6);
    expect(s.fzRear).toBeCloseTo((1 - V.weight_dist_front) * WEIGHT, 6);
  });

  it("transfers load rearward under acceleration and forward under braking", () => {
    const level = loads(0, 0);
    const accel = loads(0, 5);
    const brake = loads(0, -5);
    // the direction of the change is the sign-error catcher, and it holds at any ax
    expect(accel.fzRear).toBeGreaterThan(level.fzRear);
    expect(accel.fzFront).toBeLessThan(level.fzFront);
    expect(brake.fzFront).toBeGreaterThan(level.fzFront);
    expect(brake.fzRear).toBeLessThan(level.fzRear);
    // transfer is internal: what one axle gains the other loses, exactly
    const transfer = (V.mass_kg * 5 * V.cg_height_m) / V.wheelbase_m;
    expect(accel.fzRear - accel.fzFront).toBeCloseTo(
      (1 - 2 * V.weight_dist_front) * WEIGHT + 2 * transfer,
      6,
    );
  });

  it("only puts the front axle above the rear once braking is hard enough", () => {
    // at 44% front the rear starts 1530 N up, and a transfer of m*ax*h/L has to clear half of
    // that to reverse the ordering, so the crossover sits at 5.2 m/s2. this is a real property
    // of a rear-biased car, not a threshold to tune: light braking loads the front without
    // making it the heavier axle, and only a genuine stop puts the weight over the nose.
    const crossover =
      ((1 - 2 * V.weight_dist_front) * WEIGHT * V.wheelbase_m) /
      (2 * V.mass_kg * V.cg_height_m);
    expect(crossover).toBeCloseTo(5.2, 1);
    expect(loads(0, -(crossover - 1)).fzFront).toBeLessThan(loads(0, -(crossover - 1)).fzRear);
    const hard = loads(0, -12); // a GT3 stop, well past the crossover
    expect(hard.fzFront).toBeGreaterThan(hard.fzRear);
  });

  it("conserves the total normal load through any transfer", () => {
    for (const ax of [-12, -5, 0, 3, 8]) {
      const s = loads(0, ax);
      expect(s.fzFront + s.fzRear).toBeCloseTo(WEIGHT, 6);
    }
  });

  it("adds downforce by aero balance, with no cos(theta) on it", () => {
    const v = 60;
    const fd = 0.5 * V.air_density_kgpm3 * V.downforce_area_m2 * v * v;
    const s = loads(v, 0);
    expect(s.fzFront + s.fzRear).toBeCloseTo(WEIGHT + fd, 6);
    expect(s.fzFront).toBeCloseTo(V.weight_dist_front * WEIGHT + V.aero_balance_front * fd, 6);
  });

  it("reduces the weight component on a slope but not the downforce", () => {
    const cos = Math.cos(0.15);
    const s = loads(0, 0, cos);
    expect(s.fzFront + s.fzRear).toBeCloseTo(WEIGHT * cos, 6);
  });

  it("compresses in a valley and unloads over a crest", () => {
    const v = 70;
    expect(loads(v, 0, 1, 0.0025).fzFront).toBeGreaterThan(loads(v, 0, 1, 0).fzFront);
    expect(loads(v, 0, 1, -0.0025).fzFront).toBeLessThan(loads(v, 0, 1, 0).fzFront);
  });

  it("never lets an axle load fall below the numerical floor", () => {
    const s = loads(80, 0, 1, -0.01); // a crest steep enough to throw the car off the road
    expect(s.fzFront).toBeGreaterThanOrEqual(C.fzFloor);
    expect(s.fzRear).toBeGreaterThanOrEqual(C.fzFloor);
  });
});

describe("load-sensitive grip", () => {
  it("gives exactly mu*g at the reference condition", () => {
    // the calibration invariant: Fz0 is the static axle load, so at rest on the level with no
    // aero every axle sits at its own reference and the grip slider means what it says
    expect(ayMaxMps2(C, newAxleState(), 0)).toBeCloseTo(V.mu * V.g_mps2, 9);
  });

  it("still grows with speed, but by less than downforce alone would give", () => {
    const scratch = newAxleState();
    const ay50 = ayMaxMps2(C, scratch, 50);
    expect(ay50).toBeGreaterThan(ayMaxMps2(C, scratch, 20));
    const naive = V.mu * (V.g_mps2 + (C.downforceCoeff * 50 * 50) / V.mass_kg);
    expect(ay50).toBeLessThan(naive);
    expect(ay50).toBeGreaterThan(naive * 0.9);
  });

  it("is maximal at zero longitudinal force (the Jensen bound the speed cap relies on)", () => {
    const scratch = newAxleState();
    for (const v of [10, 40, 70]) {
      const atRest = ayMaxMps2(C, scratch, v, 0);
      for (const ax of [-14, -8, -3, 3, 8, 14]) {
        expect(ayMaxMps2(C, scratch, v, ax)).toBeLessThanOrEqual(atRest + 1e-9);
      }
    }
  });

  it("makes an overloaded axle less grippy per newton", () => {
    const light = loads(0, -8);
    const heavy = loads(0, 8);
    // the rear carries more load under acceleration but a lower friction coefficient
    expect(heavy.fzRear).toBeGreaterThan(light.fzRear);
    expect(heavy.gripRear / heavy.fzRear).toBeLessThan(light.gripRear / light.fzRear);
  });
});
