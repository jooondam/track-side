// braking-point markers: a wedge where each braking zone begins, recomputed from the
// live velocity profile: drag the grip slider and watch the braking points physically
// move up and down the road. Fixed-capacity InstancedMesh; extra instances are hidden by
// zero-scaling their matrices.

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { LineData } from "../assets";
import type { VelocityProfileResult } from "../solver/velocity";
import { PHASE_BRAKE } from "../solver/velocity";
import { useThemeTokens } from "../ui/theme";

const MAX_MARKERS = 48;
const LATERAL_OFFSET_M = 11; // clear of the racing line and roughly at the track edge

interface BrakingMarkersProps {
  line: LineData;
  result: VelocityProfileResult;
}

export function BrakingMarkers({ line, result }: BrakingMarkersProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const tokens = useThemeTokens();

  const brakeStarts = useMemo(() => {
    const starts: number[] = [];
    for (let i = 1; i < line.nPoints; i++) {
      if (result.phase[i] === PHASE_BRAKE && result.phase[i - 1] !== PHASE_BRAKE) {
        starts.push(i);
        if (starts.length >= MAX_MARKERS) break;
      }
    }
    return starts;
  }, [line, result]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    for (let m = 0; m < MAX_MARKERS; m++) {
      if (m < brakeStarts.length) {
        const i = brakeStarts[m];
        const ahead = Math.min(i + 3, line.nPoints - 1);
        const dx = line.positionYup[3 * ahead] - line.positionYup[3 * i];
        const dz = line.positionYup[3 * ahead + 2] - line.positionYup[3 * i + 2];
        // offset to the side of the road, like a real braking board. On the racing line itself
        // the chase camera drives straight through them, and they sat on top of the very data
        // they are annotating. Left normal of the travel direction in the ground plane.
        const len = Math.max(Math.hypot(dx, dz), 1e-6);
        const nx = -dz / len;
        const nz = dx / len;
        dummy.position.set(
          line.positionYup[3 * i] + nx * LATERAL_OFFSET_M,
          line.positionYup[3 * i + 1] + 0.75,
          line.positionYup[3 * i + 2] + nz * LATERAL_OFFSET_M,
        );
        dummy.rotation.set(0, Math.atan2(-dz, dx) + Math.PI / 2, 0);
        dummy.scale.setScalar(1);
      } else {
        dummy.position.set(0, -1000, 0);
        dummy.scale.setScalar(0);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(m, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [brakeStarts, line]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_MARKERS]}>
      {/* marker-board sized: at the original 0.9 x 2.2 these towered over a life-size car */}
      <coneGeometry args={[0.5, 1.4, 4]} />
      <meshStandardMaterial
        color={tokens.phaseBrake}
        emissive={tokens.phaseBrake}
        emissiveIntensity={0.7}
      />
    </instancedMesh>
  );
}
