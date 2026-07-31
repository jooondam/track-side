// animated car marker: a procedural low-poly GT3 silhouette driving the racing line at the
// *solved* v(s) -- it crawls through hairpins and flies down straights because its position
// comes from integrating the actual velocity profile, not a constant parameter speed.
//
// the silhouette is deliberately generic (wide body, cabin wedge, big rear wing): real GT3
// cars are manufacturers' trademarked designs, and DESIGN_NOTES section 5 keeps marks and
// likenesses out of the UI entirely, so no downloaded car model.

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { LineData } from "../assets";
import type { VelocityProfileResult } from "../solver/velocity";

interface CarMarkerProps {
  line: LineData;
  result: VelocityProfileResult;
  playing: boolean;
  speedMultiplier: number;
  exaggeration: number;
  progressRef: React.MutableRefObject<{ sM: number; vMps: number }>;
}

export function CarMarker({
  line,
  result,
  playing,
  speedMultiplier,
  exaggeration,
  progressRef,
}: CarMarkerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const sRef = useRef(0);

  // cumulative time to reach each line point under the current profile; rebuilt on each new
  // solve (cheap: one O(n) pass), lets the frame loop map elapsed time -> arc length exactly
  const cumTime = useMemo(() => {
    const n = line.nPoints;
    const t = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const ds = line.sM[i] - line.sM[i - 1];
      t[i] = t[i - 1] + (2 * ds) / (result.vMps[i - 1] + result.vMps[i]);
    }
    return t;
  }, [line, result]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const lapTime = cumTime[cumTime.length - 1];

    if (playing) {
      // advance in time-domain, wrap by lap
      const sNow = sRef.current;
      // current time via binary search on s (monotone), then step forward
      let lo = 0;
      let hi = line.nPoints - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (line.sM[mid] <= sNow) lo = mid;
        else hi = mid;
      }
      const segFrac = (sNow - line.sM[lo]) / Math.max(line.sM[hi] - line.sM[lo], 1e-9);
      const tNow = cumTime[lo] + segFrac * (cumTime[hi] - cumTime[lo]);
      let tNext = (tNow + delta * speedMultiplier) % lapTime;

      // time -> s: binary search on cumTime (also monotone)
      lo = 0;
      hi = line.nPoints - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cumTime[mid] <= tNext) lo = mid;
        else hi = mid;
      }
      const tFrac = (tNext - cumTime[lo]) / Math.max(cumTime[hi] - cumTime[lo], 1e-9);
      sRef.current = line.sM[lo] + tFrac * (line.sM[hi] - line.sM[lo]);
    }

    // place + orient at sRef
    const s = sRef.current;
    let lo = 0;
    let hi = line.nPoints - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (line.sM[mid] <= s) lo = mid;
      else hi = mid;
    }
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

    const vNow = result.vMps[lo] + f * (result.vMps[hi] - result.vMps[lo]);
    progressRef.current.sM = s;
    progressRef.current.vMps = vNow;
  });

  return (
    <group ref={groupRef} scale={[3, 3, 3]}>
      {/* body: wide, low box with a slight nose taper via two stacked boxes */}
      <mesh position={[0, 0.35, 0]}>
        <boxGeometry args={[1.9, 0.5, 4.4]} />
        <meshStandardMaterial color="#15151c" roughness={0.4} metalness={0.6} />
      </mesh>
      {/* cabin wedge */}
      <mesh position={[0, 0.75, 0.25]}>
        <boxGeometry args={[1.35, 0.42, 1.9]} />
        <meshStandardMaterial color="#101016" roughness={0.3} metalness={0.7} />
      </mesh>
      {/* glowing accent stripe down the centreline */}
      <mesh position={[0, 0.62, 0]}>
        <boxGeometry args={[0.12, 0.02, 4.2]} />
        <meshStandardMaterial color="#00e5ff" emissive="#00e5ff" emissiveIntensity={2.0} />
      </mesh>
      {/* rear wing on swan-neck pylons */}
      <mesh position={[0, 0.95, 2.0]}>
        <boxGeometry args={[1.7, 0.06, 0.45]} />
        <meshStandardMaterial color="#15151c" roughness={0.4} metalness={0.6} />
      </mesh>
      <mesh position={[-0.5, 0.75, 2.05]}>
        <boxGeometry args={[0.08, 0.35, 0.12]} />
        <meshStandardMaterial color="#15151c" />
      </mesh>
      <mesh position={[0.5, 0.75, 2.05]}>
        <boxGeometry args={[0.08, 0.35, 0.12]} />
        <meshStandardMaterial color="#15151c" />
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
          <meshStandardMaterial color="#050508" roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}
