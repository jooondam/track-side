// braking-point markers: a wedge where each braking zone begins, recomputed from the
// live velocity profile: drag the grip slider and watch the braking points physically
// move up and down the road. Fixed-capacity InstancedMesh; extra instances are hidden by
// zero-scaling their matrices.

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { LineData, TrackLines } from "../assets";
import type { LapProgress } from "./CarMarker";
import type { VelocityProfileResult } from "../solver/velocity";
import { PHASE_BRAKE } from "../solver/velocity";
import { useThemeTokens } from "../ui/theme";
import { outboard, sampleBoundary, type Side } from "./trackFrame";

const MAX_MARKERS = 48;
/** how far past the road edge a marker stands. */
const OUTBOARD_M = 3;
/** arc length either side of a marker over which the car's approach lights it up. */
const PULSE_REACH_M = 120;

interface BrakingMarkersProps {
  line: LineData;
  trackLines: TrackLines;
  result: VelocityProfileResult;
  progressRef?: React.MutableRefObject<LapProgress>;
}

export function BrakingMarkers({ line, trackLines, result, progressRef }: BrakingMarkersProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
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
        const s = line.sM[i];
        const lx = line.positionYup[3 * i];
        const lz = line.positionYup[3 * i + 2];

        // Stand the marker beside the road, on whichever side has room.
        //
        // It used to sit a flat 11 m from the racing line along an inline normal that was the
        // right normal while its comment said left. Both halves were wrong: at Spa 5 of 141
        // markers ended up on the racing surface, the worst 4.58 m inside the edge, because
        // the line hugs the apex and 11 m from there crosses the whole carriageway.
        //
        // Picking the farther edge needs no curvature reasoning and cannot be inverted: the
        // line is always nearer the inside of a corner, so the far edge is always the one with
        // the run-off beside it.
        const left = sampleBoundary(trackLines, s, "left");
        const right = sampleBoundary(trackLines, s, "right");
        const dLeft = Math.hypot(left.x - lx, left.z - lz);
        const dRight = Math.hypot(right.x - lx, right.z - lz);
        const side: Side = dLeft >= dRight ? "left" : "right";
        const frame = side === "left" ? left : right;

        const [px, pz] = outboard(frame, side, OUTBOARD_M);
        dummy.position.set(px, frame.y + 0.75, pz);
        dummy.rotation.set(0, Math.atan2(-frame.tz, frame.tx) + Math.PI / 2, 0);
        dummy.scale.setScalar(1);
      } else {
        dummy.position.set(0, -1000, 0);
        dummy.scale.setScalar(0);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(m, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [brakeStarts, line, trackLines]);

  // per-instance brightness, so the marker the car is approaching lights up as it arrives.
  //
  // The point is to tie a static annotation to the moving thing it annotates: under playback the
  // marker for *this* braking zone brightens on the approach and drops away behind, so the eye is
  // told which of the forty-eight cones is the one that matters right now. Slider-driven too, not
  // just playback: drag the grip down and the markers physically move up the road.
  //
  // InstancedMesh carries one material, so the variation rides on instanceColor. Standard
  // materials already multiply diffuse by it; the patch below extends that to emissive, without
  // which a "glow" would only ever be a change of paint.
  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
         #ifdef USE_INSTANCING_COLOR
           totalEmissiveRadiance *= vColor;
         #endif`,
      );
    };
    material.needsUpdate = true;
  }, []);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || !progressRef) return;
    if (!mesh.instanceColor) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(MAX_MARKERS * 3).fill(1),
        3,
      );
    }
    const loop = line.loopLengthM;
    const head = progressRef.current.sM;
    const colour = new THREE.Color();
    for (let m = 0; m < brakeStarts.length; m++) {
      // distance from the car back to this marker, wrapped: only the marker behind or under the
      // car lights up, so a zone brightens on arrival rather than announcing itself from a lap away
      const behind = ((head - line.sM[brakeStarts[m]]) % loop + loop) % loop;
      const t = behind < PULSE_REACH_M ? 1 - behind / PULSE_REACH_M : 0;
      const k = 1 + t * t * 3.2;
      colour.setRGB(k, k, k);
      mesh.setColorAt(m, colour);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_MARKERS]}>
      {/* marker-board sized: at the original 0.9 x 2.2 these towered over a life-size car */}
      <coneGeometry args={[0.5, 1.4, 4]} />
      <meshStandardMaterial
        ref={materialRef}
        color={tokens.phaseBrake}
        emissive={tokens.phaseBrake}
        emissiveIntensity={0.7}
      />
    </instancedMesh>
  );
}
