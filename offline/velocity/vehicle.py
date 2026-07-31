"""generic GT3 point-mass vehicle model.

parameters are reasoned estimates, not measurements -- there is no public GT3 ggv diagram
(docs/DESIGN_NOTES.md assumption #5). Only the lumped products downforce_area_m2 (C_L*A) and
drag_area_m2 (C_d*A) are stored, since that's all the physics below ever uses; splitting them
into individual C_L/C_d/A values would imply a precision the estimate doesn't have.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class GT3Vehicle:
    mass_kg: float = 1300.0
    mu: float = 1.2
    downforce_area_m2: float = 2.8
    drag_area_m2: float = 1.35
    power_w: float = 410_000.0
    air_density_kgpm3: float = 1.225
    g_mps2: float = 9.81
    v_floor_mps: float = 2.0

    def ay_max_mps2(self, v_mps: float) -> float:
        """max lateral accel from tire grip + speed-dependent downforce: mu*(g + D*v^2/m)."""
        downforce_term = 0.5 * self.air_density_kgpm3 * self.downforce_area_m2 * v_mps**2
        return self.mu * (self.g_mps2 + downforce_term / self.mass_kg)

    def ax_drag_mps2(self, v_mps: float) -> float:
        """drag deceleration magnitude at v_mps."""
        return 0.5 * self.air_density_kgpm3 * self.drag_area_m2 * v_mps**2 / self.mass_kg

    def ax_engine_mps2(self, v_mps: float) -> float:
        """engine-limited accel at v_mps, floored to avoid division by ~zero speed."""
        return self.power_w / (self.mass_kg * max(v_mps, self.v_floor_mps))

    @property
    def v_top_mps(self) -> float:
        """closed-form drag/engine equilibrium speed: solves ax_engine(v) == ax_drag(v)."""
        drag_coeff = 0.5 * self.air_density_kgpm3 * self.drag_area_m2
        return (self.power_w / drag_coeff) ** (1.0 / 3.0)


DEFAULT_GT3 = GT3Vehicle()
