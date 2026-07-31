// loads the per-circuit assets offline/build_viewer_assets.py generates into /public.

import type { GT3Vehicle } from "./solver/vehicle";

export interface LineData {
  positionYup: Float32Array; // flat xyz, glTF Y-up frame, metres
  sM: Float64Array; // closed-duplicate arc length
  kappa1pm: Float64Array;
  loopLengthM: number;
  nPoints: number;
}

export interface CircuitAssets {
  line: LineData;
  vehicleBase: GT3Vehicle; // defaults from Python; mu overridden by the slider
  glbUrl: string;
}

export async function loadCircuitAssets(circuitId: string): Promise<CircuitAssets> {
  const base = `${import.meta.env.BASE_URL}${circuitId}`;
  const [lineRaw, vehicleBase] = await Promise.all([
    fetch(`${base}/line.json`).then((r) => {
      if (!r.ok) throw new Error(`failed to load ${base}/line.json: ${r.status}`);
      return r.json();
    }),
    fetch(`${base}/vehicle.json`).then((r) => {
      if (!r.ok) throw new Error(`failed to load ${base}/vehicle.json: ${r.status}`);
      return r.json() as Promise<GT3Vehicle>;
    }),
  ]);

  const positions = lineRaw.line.position_yup as number[][];
  const flat = new Float32Array(positions.length * 3);
  for (let i = 0; i < positions.length; i++) {
    flat[3 * i] = positions[i][0];
    flat[3 * i + 1] = positions[i][1];
    flat[3 * i + 2] = positions[i][2];
  }

  return {
    line: {
      positionYup: flat,
      sM: Float64Array.from(lineRaw.line.s_m as number[]),
      kappa1pm: Float64Array.from(lineRaw.line.kappa_1pm as number[]),
      loopLengthM: lineRaw.meta.loop_length_m as number,
      nPoints: lineRaw.meta.n_points as number,
    },
    vehicleBase,
    glbUrl: `${base}/track.glb`,
  };
}
