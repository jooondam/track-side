"""generic GT3 vehicle model: two-axle, quasi-steady, with longitudinal load transfer.

parameters are reasoned estimates, not measurements. there is no public GT3 ggv diagram
(docs/DESIGN_NOTES.md assumption #5). only the lumped products downforce_area_m2 (C_L*A) and
drag_area_m2 (C_d*A) are stored, since that's all the aero physics below ever uses; splitting
them into individual C_L/C_d/A values would imply a precision the estimate doesn't have.

M8 replaced the single lumped friction circle with a per-axle model:

  Fz_norm  = m*(g*cos(theta) + v^2*kappa_v)      weight on a graded road, plus the vertical
                                                 curvature term that compresses at Eau Rouge
                                                 and unloads over the Raidillon crest
  Fd       = 0.5*rho*ClA*v^2                     downforce, normal to the road plane, so it
                                                 carries no cos(theta)
  dFz      = m*ax_tyre*h_cg/wheelbase            longitudinal transfer

  Fz_front = wd_f*Fz_norm     - dFz + ab_f*Fd
  Fz_rear  = (1-wd_f)*Fz_norm + dFz + (1-ab_f)*Fd

the transfer is driven by ax_tyre, the longitudinal acceleration the tyres themselves produce,
not by the vehicle's net acceleration. that is the physically correct quantity (the tyre force
is the only along-road force acting at ground level, so it is the only one with a moment arm
about the contact patches) and it makes grade fall out for free: a car held on a downhill has
ax_tyre = g*sin(theta) and correctly loads its front axle while its net acceleration is zero.

grip is load sensitive per axle, mu_axle = mu*(Fz/Fz0)^-k, with the reference load Fz0 chosen
as the static axle load. that choice is a calibration invariant, not a coincidence: at rest on
the level with no aero, Fz == Fz0 exactly, so mu_front == mu_rear == mu and ay_max(0) == mu*g
exactly. the grip slider therefore keeps meaning exactly what it meant before M8.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# fixed-point iteration counts. these are part of the model, not tuning knobs: the TypeScript
# port in src/solver/vehicle.ts must use the identical values or the two solvers diverge, so
# they are exported here, mirrored there, and carried in the viewer fixtures' meta block where
# velocity.test.ts cross-checks them. justified by measurement in test_loads.py, not by taste.
#
# LOAD_TRANSFER_ITERS is 4 rather than 3 because the braking branch contracts more slowly than
# a first look suggests. the transfer path alone is (1-k)*mu*h_cg/wheelbase ~ 0.12, but braking
# divides the front axle's capacity by brake_bias_front to get the total, so the loop gain is
# really (1-k)*mu_f*h_cg/(wheelbase*bias_f) ~ 0.20. that leaves 0.8% after three passes and
# 0.14% after four, measured in test_loads.py. the fourth pass costs 1.7 ms on Spa against a
# 16 ms budget, which is cheap for taking a systematic braking error off the table.
LOAD_TRANSFER_ITERS = 4
CAP_ITERS = 5


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

    # M8 two-axle parameters. see docs/DESIGN_NOTES.md section 3 M8 for the sourcing of each.
    wheelbase_m: float = 2.65
    cg_height_m: float = 0.30
    weight_dist_front: float = 0.44
    brake_bias_front: float = 0.62
    tyre_load_sensitivity: float = 0.10
    aero_balance_front: float = 0.45
    fz_floor_frac: float = 0.02
    drive_axle: str = "rear"

    # ---- derived constants -------------------------------------------------------------

    @property
    def weight_n(self) -> float:
        return self.mass_kg * self.g_mps2

    @property
    def fz0_front_n(self) -> float:
        """static front axle load, the reference for front load sensitivity."""
        return self.weight_dist_front * self.weight_n

    @property
    def fz0_rear_n(self) -> float:
        """static rear axle load, the reference for rear load sensitivity."""
        return (1.0 - self.weight_dist_front) * self.weight_n

    @property
    def fz_floor_n(self) -> float:
        """numerical floor on an axle load. not physics: the car is never modelled airborne."""
        return self.fz_floor_frac * self.weight_n

    @property
    def downforce_coeff(self) -> float:
        return 0.5 * self.air_density_kgpm3 * self.downforce_area_m2

    @property
    def drag_coeff(self) -> float:
        return 0.5 * self.air_density_kgpm3 * self.drag_area_m2

    @property
    def transfer_coeff(self) -> float:
        """dFz per unit ax_tyre: m*h_cg/wheelbase."""
        return self.mass_kg * self.cg_height_m / self.wheelbase_m

    @property
    def grip_coeff_front(self) -> float:
        """mu*Fz0^k, the hoisted half of mu_front*Fz_front = mu*Fz0^k*Fz^(1-k)."""
        return self.mu * self.fz0_front_n**self.tyre_load_sensitivity

    @property
    def grip_coeff_rear(self) -> float:
        return self.mu * self.fz0_rear_n**self.tyre_load_sensitivity

    @property
    def v_top_mps(self) -> float:
        """closed-form drag/engine equilibrium speed: solves ax_engine(v) == ax_drag(v)."""
        return (self.power_w / self.drag_coeff) ** (1.0 / 3.0)

    # ---- aero and engine ---------------------------------------------------------------

    def downforce_n(self, v_mps):
        return self.downforce_coeff * np.square(v_mps)

    def ax_drag_mps2(self, v_mps):
        """drag deceleration magnitude at v_mps."""
        return self.drag_coeff * np.square(v_mps) / self.mass_kg

    def ax_engine_mps2(self, v_mps):
        """engine-limited accel at v_mps, floored to avoid division by ~zero speed."""
        return self.power_w / (self.mass_kg * np.maximum(v_mps, self.v_floor_mps))

    # ---- loads and grip ----------------------------------------------------------------

    def axle_loads_n(
        self,
        v_mps,
        ax_tyre_mps2=0.0,
        sin_theta=0.0,
        cos_theta=1.0,
        kappa_v_1pm=0.0,
    ):
        """(Fz_front, Fz_rear) in newtons. sin_theta is unused directly: grade enters through
        cos_theta on the weight and through ax_tyre, which already carries the g*sin(theta)
        the tyres must fight. it stays in the signature so callers pass a complete road state
        and so the TypeScript mirror has the same shape."""
        del sin_theta  # see docstring: grade reaches the loads via cos_theta and ax_tyre
        fz_norm = self.mass_kg * (self.g_mps2 * cos_theta + np.square(v_mps) * kappa_v_1pm)
        fd = self.downforce_n(v_mps)
        d_fz = self.transfer_coeff * ax_tyre_mps2

        fz_front = self.weight_dist_front * fz_norm - d_fz + self.aero_balance_front * fd
        fz_rear = (1.0 - self.weight_dist_front) * fz_norm + d_fz + (
            1.0 - self.aero_balance_front
        ) * fd
        floor = self.fz_floor_n
        return np.maximum(fz_front, floor), np.maximum(fz_rear, floor)

    def axle_grip_n(self, fz_front_n, fz_rear_n):
        """(G_front, G_rear), the maximum resultant tyre force each axle can carry.

        G = mu_axle*Fz = mu*(Fz/Fz0)^-k * Fz = mu*Fz0^k * Fz^(1-k). written in the factorised
        form so it costs one power per axle rather than a power, a divide and a multiply.
        """
        exponent = 1.0 - self.tyre_load_sensitivity
        return (
            self.grip_coeff_front * np.power(fz_front_n, exponent),
            self.grip_coeff_rear * np.power(fz_rear_n, exponent),
        )

    def ay_max_mps2(
        self,
        v_mps,
        ax_tyre_mps2=0.0,
        sin_theta=0.0,
        cos_theta=1.0,
        kappa_v_1pm=0.0,
    ):
        """max lateral accel with no longitudinal tyre force left over.

        maximal at ax_tyre == 0: Fz^(1-k) is concave and load transfer conserves the total, so
        by Jensen any transfer strictly reduces G_front + G_rear. that is what makes the
        lateral speed cap in solver.py a rigorous upper bound rather than an estimate.
        """
        fz_front, fz_rear = self.axle_loads_n(
            v_mps, ax_tyre_mps2, sin_theta, cos_theta, kappa_v_1pm
        )
        grip_front, grip_rear = self.axle_grip_n(fz_front, fz_rear)
        return (grip_front + grip_rear) / self.mass_kg

    def lateral_shares(self, grip_front_n, grip_rear_n, fy_needed_n):
        """(Fy_front, Fy_rear): lateral demand split proportional to axle grip capacity.

        this is the "balanced car" assumption (register #20). it is not solved from a yaw
        moment balance, which would need a tyre slip model this project does not have. note
        that the proportional split is exactly what makes the per-axle circles collapse back
        to the single lumped circle used before M8 whenever brake bias happens to match the
        load split, so the new model is a strict generalisation of the old one.
        """
        total = grip_front_n + grip_rear_n
        share_front = grip_front_n / total
        return fy_needed_n * share_front, fy_needed_n * (1.0 - share_front)

    def longitudinal_capacity_n(self, grip_front_n, grip_rear_n, fy_needed_n):
        """(Fx_front_max, Fx_rear_max) left after the lateral demand is met, per axle."""
        fy_front, fy_rear = self.lateral_shares(grip_front_n, grip_rear_n, fy_needed_n)
        fx_front = np.sqrt(np.maximum(np.square(grip_front_n) - np.square(fy_front), 0.0))
        fx_rear = np.sqrt(np.maximum(np.square(grip_rear_n) - np.square(fy_rear), 0.0))
        return fx_front, fx_rear

    def ax_traction_mps2(self, fx_front_n, fx_rear_n):
        """tyre-limited forward accel. RWD, so only the rear axle drives."""
        return (fx_rear_n if self.drive_axle == "rear" else fx_front_n) / self.mass_kg

    def ax_brake_mps2(self, fx_front_n, fx_rear_n):
        """tyre-limited braking magnitude under a fixed brake bias.

        total brake force F splits bias_f*F front and (1-bias_f)*F rear, so F is limited by
        whichever axle saturates first. a bias that does not match the load split costs decel,
        which is the first thing a race engineer looks for.
        """
        bias = self.brake_bias_front
        return np.minimum(fx_front_n / bias, fx_rear_n / (1.0 - bias)) / self.mass_kg


DEFAULT_GT3 = GT3Vehicle()
