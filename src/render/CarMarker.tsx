// animated car marker: a procedural low-poly GT3 silhouette driving the racing line at the
// *solved* v(s) -- it crawls through hairpins and flies down straights because its position
// comes from integrating the actual velocity profile, not a constant parameter speed.
//
// the silhouette is deliberately generic (wide body, cabin wedge, big rear wing): real GT3
// cars are manufacturers' trademarked designs, and DESIGN_NOTES section 5 keeps marks and
// likenesses out of the UI entirely, so no downloaded car model.
//
// the same component renders the optional ghost car (fixed reference grip): transparent grey
// materials, no accent stripe, its own velocity profile -- the visual gap between ghost and
// live car is the grip story told physically.

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { LineData } from "../assets";
import { buildLapTimeTable, lowerIndex, sAtTime, timeAtS } from "../solver/lapTime";
import type { VelocityProfileResult } from "../solver/velocity";

export interface LapProgress {
  sM: number;
  vMps: number;
  tS: number;
  lapTimeS: number;
  // scrub request: id increments on every new request; each marker (live and ghost) applies
  // a given id exactly once, so frame ordering between the two markers can't drop a scrub
  scrub: { id: number; s: number } | null;
}

interface CarMarkerProps {
  line: LineData;
  result: VelocityProfileResult;
  playing: boolean;
  speedMultiplier: number;
  exaggeration: number;
  ghost?: boolean;
  progressRef?: React.MutableRefObject<LapProgress>;
  poseRef?: React.MutableRefObject<{ position: THREE.Vector3; direction: THREE.Vector3 }>;
}

export function CarMarker({
  line,
  result,
  playing,
  speedMultiplier,
  exaggeration,
  ghost = false,
  progressRef,
  poseRef,
}: CarMarkerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const sRef = useRef(0);
  const lastScrubId = useRef(-1);

  const table = useMemo(
    () => buildLapTimeTable(line.sM, result.vMps),
    [line, result],
  );

  // scrub requests apply even while a different result is animating (table changes reset
  // nothing: sRef survives solver updates so the car doesn't teleport on slider drags).
  // only the live car owns the shared progress fields -- the ghost must not clobber them.
  useEffect(() => {
    if (progressRef && !ghost) progressRef.current.lapTimeS = table.lapTimeS;
  }, [table, progressRef, ghost]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    const scrub = progressRef?.current.scrub;
    if (scrub && scrub.id !== lastScrubId.current) {
      sRef.current = scrub.s; // ghost jumps with the live car so comparisons restart aligned
      lastScrubId.current = scrub.id;
    }

    if (playing) {
      const tNow = timeAtS(table, line.sM, sRef.current);
      sRef.current = sAtTime(table, line.sM, tNow + delta * speedMultiplier);
    }

    const s = sRef.current;
    const lo = lowerIndex(line.sM, s);
    const hi = Math.min(lo + 1, line.nPoints - 1);
    const f = (s - line.sM[lo]) / Math.max(line.sM[hi] - line.sM[lo], 1e-9);
    const x = line.positionYup[3 * lo] + f * (line.positionYup[3 * hi] - line.positionYup[3 * lo]);
    const y =
      line.positionYup[3 * lo + 1] + f * (line.positionYup[3 * hi + 1] - line.positionYup[3 * lo + 1]);
    const z =
      line.positionYup[3 * lo + 2] + f * (line.positionYup[3 * hi + 2] - line.positionYup[3 * lo + 2]);
    groupRef.current.position.set(x, y * exaggeration + 0.4, z);

    // yaw from the ground-plane tangent (pitch skipped: at 3x exaggeration a pitched car
    // reads as broken rather than informative)
    const ahead = (hi + 4) % (line.nPoints - 1);
    const dx = line.positionYup[3 * ahead] - x;
    const dz = line.positionYup[3 * ahead + 2] - z;
    groupRef.current.rotation.y = Math.atan2(-dz, dx) + Math.PI / 2;

    if (!ghost && progressRef) {
      const vNow = result.vMps[lo] + f * (result.vMps[hi] - result.vMps[lo]);
      progressRef.current.sM = s;
      progressRef.current.vMps = vNow;
      progressRef.current.tS = timeAtS(table, line.sM, s);
    }
    if (!ghost && poseRef) {
      poseRef.current.position.set(x, y * exaggeration + 0.4, z);
      const len = Math.hypot(dx, dz);
      if (len > 1e-6) poseRef.current.direction.set(dx / len, 0, dz / len);
    }
  });

  const bodyProps = ghost
    ? { color: "#8a8a94", transparent: true, opacity: 0.35, roughness: 0.6, metalness: 0.1 }
    : { color: "#15151c", roughness: 0.4, metalness: 0.6 };
  const cabinProps = ghost
    ? { color: "#8a8a94", transparent: true, opacity: 0.3, roughness: 0.6, metalness: 0.1 }
    : { color: "#101016", roughness: 0.3, metalness: 0.7 };

  return (
    <group ref={groupRef} scale={[3, 3, 3]}>
      {/* body: wide, low box */}
      <mesh position={[0, 0.35, 0]}>
        <boxGeometry args={[1.9, 0.5, 4.4]} />
        <meshStandardMaterial {...bodyProps} />
      </mesh>
      {/* cabin wedge */}
      <mesh position={[0, 0.75, 0.25]}>
        <boxGeometry args={[1.35, 0.42, 1.9]} />
        <meshStandardMaterial {...cabinProps} />
      </mesh>
      {/* glowing accent stripe (live car only) */}
      {!ghost && (
        <mesh position={[0, 0.62, 0]}>
          <boxGeometry args={[0.12, 0.02, 4.2]} />
          <meshStandardMaterial color="#00e5ff" emissive="#00e5ff" emissiveIntensity={2.0} />
        </mesh>
      )}
      {/* rear wing on swan-neck pylons */}
      <mesh position={[0, 0.95, 2.0]}>
        <boxGeometry args={[1.7, 0.06, 0.45]} />
        <meshStandardMaterial {...bodyProps} />
      </mesh>
      <mesh position={[-0.5, 0.75, 2.05]}>
        <boxGeometry args={[0.08, 0.35, 0.12]} />
        <meshStandardMaterial {...bodyProps} />
      </mesh>
      <mesh position={[0.5, 0.75, 2.05]}>
        <boxGeometry args={[0.08, 0.35, 0.12]} />
        <meshStandardMaterial {...bodyProps} />
      </mesh>
      {/* wheels */}
      {(
        [
          [-0.85, 1.45],
          [0.85, 1.45],
          [-0.85, -1.45],
          [0.85, -1.45],
        ] as const
      ).map(([wx, wz], i) => (
        <mesh key={i} position={[wx, 0.32, wz]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.32, 0.32, 0.3, 16]} />
          <meshStandardMaterial
            color="#050508"
            roughness={0.8}
            transparent={ghost}
            opacity={ghost ? 0.35 : 1}
          />
        </mesh>
      ))}
    </group>
  );
}
