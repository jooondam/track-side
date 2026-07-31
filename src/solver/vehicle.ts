// GT3 point-mass vehicle model: TypeScript mirror of offline/velocity/vehicle.py.
// parameter values are never hardcoded here; they load from public/<circuit>/vehicle.json,
// which offline/build_viewer_assets.py exports from the Python dataclass: one source of
// truth for physics constants. Only mu is varied at runtime (the grip slider).

export interface GT3Vehicle {
  mass_kg: number;
  mu: number;
  downforce_area_m2: number;
  drag_area_m2: number;
  power_w: number;
  air_density_kgpm3: number;
  g_mps2: number;
  v_floor_mps: number;
}

export function ayMaxMps2(vehicle: GT3Vehicle, vMps: number): number {
  const downforceTerm = 0.5 * vehicle.air_density_kgpm3 * vehicle.downforce_area_m2 * vMps * vMps;
  return vehicle.mu * (vehicle.g_mps2 + downforceTerm / vehicle.mass_kg);
}

export function axDragMps2(vehicle: GT3Vehicle, vMps: number): number {
  return (0.5 * vehicle.air_density_kgpm3 * vehicle.drag_area_m2 * vMps * vMps) / vehicle.mass_kg;
}

export function axEngineMps2(vehicle: GT3Vehicle, vMps: number): number {
  return vehicle.power_w / (vehicle.mass_kg * Math.max(vMps, vehicle.v_floor_mps));
}

export function vTopMps(vehicle: GT3Vehicle): number {
  const dragCoeff = 0.5 * vehicle.air_density_kgpm3 * vehicle.drag_area_m2;
  return Math.cbrt(vehicle.power_w / dragCoeff);
}
