// animated car marker: a procedural low-poly GT3 silhouette driving the racing line at the
// *solved* v(s): it crawls through hairpins and flies down straights because its position
// comes from integrating the actual velocity profile, not a constant parameter speed.
//
// the silhouette is deliberately generic (wide body, cabin wedge, big rear wing): real GT3
// cars are manufacturers' trademarked designs, and DESIGN_NOTES section 5 keeps marks and
// likenesses out of the UI entirely, so no downloaded car model.
//
// the same component renders the optional ghost car (fixed reference grip): transparent grey
// materials, no accent stripe, its own velocity profile: the visual gap between ghost and
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
  // only the live car owns the shared progress fields: the ghost must not clobber them.
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

  // the body is an extruded 2D side profile (nose, rising hood, raked windshield, roof,
  // fastback tail): dramatically more car-shaped than stacked boxes, still zero assets.
  // shape x axis = car length with the nose at +x; rotation.y = PI/2 maps shape +x to world
  // -z, which is this marker's direction of travel, and the extrusion (local +z, the car's
  // width) onto world +x.
  const bodyGeometry = useMemo(() => {
    const profile = new THREE.Shape();
    profile.moveTo(2.2, 0.1); // front floor
    profile.lineTo(2.28, 0.24); // splitter lip
    profile.lineTo(2.18, 0.44); // nose
    profile.lineTo(1.15, 0.6); // hood
    profile.lineTo(0.55, 0.64); // windshield base
    profile.lineTo(0.02, 1.06); // roof front
    profile.lineTo(-0.78, 1.02); // roof rear
    profile.lineTo(-1.6, 0.7); // rear window to deck
    profile.lineTo(-2.12, 0.68); // deck
    profile.lineTo(-2.2, 0.42); // tail cut
    profile.lineTo(-2.14, 0.1); // rear floor
    profile.closePath();
    const geo = new THREE.ExtrudeGeometry(profile, {
      depth: 1.66,
      bevelEnabled: true,
      bevelThickness: 0.09,
      bevelSize: 0.09,
      bevelSegments: 2,
    });
    return geo;
  }, []);

  const paint = ghost
    ? { color: "#8a8a94", transparent: true, opacity: 0.3, roughness: 0.6, metalness: 0.1 }
    : { color: "#ff6a00", roughness: 0.35, metalness: 0.25, emissive: "#992e00", emissiveIntensity: 0.25 };
  const carbon = ghost
    ? { color: "#8a8a94", transparent: true, opacity: 0.3, roughness: 0.6, metalness: 0.1 }
    : { color: "#111116", roughness: 0.5, metalness: 0.4 };
  const glass = ghost
    ? { color: "#8a8a94", transparent: true, opacity: 0.25, roughness: 0.6, metalness: 0.1 }
    : { color: "#0c1218", roughness: 0.15, metalness: 0.8 };

  return (
    <group ref={groupRef} scale={[3, 3, 3]}>
      {/* painted body shell */}
      <mesh geometry={bodyGeometry} rotation={[0, Math.PI / 2, 0]} position={[-0.92, 0, 0]}>
        <meshStandardMaterial {...paint} />
      </mesh>
      {/* greenhouse: a hair wider than the shell so it reads as wraparound glazing */}
      <mesh position={[0, 0.82, 0.35]}>
        <boxGeometry args={[1.9, 0.32, 1.5]} />
        <meshStandardMaterial {...glass} />
      </mesh>
      {/* front splitter */}
      <mesh position={[0, 0.12, -2.1]}>
        <boxGeometry args={[2.0, 0.05, 0.55]} />
        <meshStandardMaterial {...carbon} />
      </mesh>
      {/* rear diffuser hint */}
      <mesh position={[0, 0.14, 2.05]}>
        <boxGeometry args={[1.9, 0.08, 0.4]} />
        <meshStandardMaterial {...carbon} />
      </mesh>
      {/* rear wing + endplates on swan-neck pylons */}
      <mesh position={[0, 1.06, 2.0]}>
        <boxGeometry args={[1.8, 0.05, 0.5]} />
        <meshStandardMaterial {...carbon} />
      </mesh>
      <mesh position={[-0.88, 1.02, 2.0]}>
        <boxGeometry args={[0.04, 0.3, 0.55]} />
        <meshStandardMaterial {...carbon} />
      </mesh>
      <mesh position={[0.88, 1.02, 2.0]}>
        <boxGeometry args={[0.04, 0.3, 0.55]} />
        <meshStandardMaterial {...carbon} />
      </mesh>
      <mesh position={[-0.45, 0.85, 1.95]}>
        <boxGeometry args={[0.07, 0.4, 0.14]} />
        <meshStandardMaterial {...carbon} />
      </mesh>
      <mesh position={[0.45, 0.85, 1.95]}>
        <boxGeometry args={[0.07, 0.4, 0.14]} />
        <meshStandardMaterial {...carbon} />
      </mesh>
      {/* headlights and taillight bar */}
      {!ghost && (
        <>
          <mesh position={[-0.62, 0.46, -2.14]}>
            <boxGeometry args={[0.42, 0.1, 0.08]} />
            <meshStandardMaterial color="#eef4ff" emissive="#cfe4ff" emissiveIntensity={2.2} />
          </mesh>
          <mesh position={[0.62, 0.46, -2.14]}>
            <boxGeometry args={[0.42, 0.1, 0.08]} />
            <meshStandardMaterial color="#eef4ff" emissive="#cfe4ff" emissiveIntensity={2.2} />
          </mesh>
          <mesh position={[0, 0.58, 2.16]}>
            <boxGeometry args={[1.5, 0.07, 0.05]} />
            <meshStandardMaterial color="#ff2020" emissive="#ff2020" emissiveIntensity={2.0} />
          </mesh>
        </>
      )}
      {/* wheels: tire + bright rim disc so the wheels read at distance */}
      {(
        [
          [-0.86, 1.42],
          [0.86, 1.42],
          [-0.86, -1.42],
          [0.86, -1.42],
        ] as const
      ).map(([wx, wz], i) => (
        <group key={i} position={[wx, 0.34, wz]} rotation={[0, 0, Math.PI / 2]}>
          <mesh>
            <cylinderGeometry args={[0.34, 0.34, 0.3, 20]} />
            <meshStandardMaterial
              color="#050508"
              roughness={0.85}
              transparent={ghost}
              opacity={ghost ? 0.3 : 1}
            />
          </mesh>
          <mesh position={[0, wx > 0 ? 0.16 : -0.16, 0]}>
            <cylinderGeometry args={[0.2, 0.2, 0.02, 12]} />
            <meshStandardMaterial
              color="#b8b8c2"
              roughness={0.3}
              metalness={0.8}
              transparent={ghost}
              opacity={ghost ? 0.3 : 1}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
