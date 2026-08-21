// the car, driving the racing line at the *solved* v(s): it crawls through hairpins and flies
// down straights because its position comes from integrating the actual velocity profile, not a
// constant parameter speed.
//
// The silhouette is a generic GT3, built procedurally: real GT3 cars are manufacturers'
// trademarked designs, and DESIGN_NOTES section 5 keeps marks and likenesses out of the UI, so
// there is no downloaded model. Everything here is lathed, extruded or boxed from measurements
// that are roughly GT3-shaped: 4.6 m long, 2.0 m wide, 1.2 m tall.
//
// Local frame: nose at -z, tail at +z, roof at +y. The group yaw puts -z on the travel
// direction.
//
// The same component renders the optional ghost car (fixed reference grip): translucent neutral
// materials, no livery or lights, its own velocity profile. The visual gap between ghost and live
// car is the grip story told physically.

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { LineData } from "../assets";
import { buildLapTimeTable, lowerIndex, sAtTime, timeAtS } from "../solver/lapTime";
import type { VelocityProfileResult } from "../solver/velocity";
import { PHASE_BRAKE } from "../solver/velocity";
import { MATERIAL, useThemeTokens } from "../ui/theme";
import { blobShadowAlpha } from "./textures";

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

// A real-size car on a 7 km circuit is roughly one pixel from the overview camera, so the model
// is scaled by viewing distance and clamped: life size in the chase shots, up to 16x when the
// whole circuit is in frame. Combined with the ground beacon below, this is what makes "where is
// the car" answerable at every zoom level instead of only up close. SCALE_MIN must stay 1: at 3x
// the car was longer than the chase camera's standoff distance and filled the entire frame.
const SCALE_MIN = 1;
const SCALE_MAX = 16;
const SCALE_PER_METRE = 0.0055;
const MAX_ROLL_RAD = 0.075;
const BEACON_OUTER = 4.6; // local ring radius, before the distance compensation below

// half the model's length in its own units. at SCALE_MAX the car is ~74 m long, which is longer
// than most of the elevation features it drives over, so the road under it cannot be treated as
// a point: both the pitch and the ride height below are sampled across this footprint.
const MODEL_HALF_LENGTH = 2.3;
// ride height, in car-lengths rather than metres, so a 16x car floats 16x higher. a fixed metre
// offset is what let the scaled-up car sink into a climb: it cleared the road at the contact
// point and buried its nose 5 m further up the hill.
const CLEARANCE_PER_SCALE_M = 0.05;
const MAX_PITCH_RAD = 0.5;

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
  const bodyRef = useRef<THREE.Group>(null);
  const beaconRef = useRef<THREE.Mesh>(null);
  const shadowRef = useRef<THREE.Mesh>(null);
  const discRef = useRef<THREE.MeshStandardMaterial>(null);
  const sRef = useRef(0);
  const lastScrubId = useRef(-1);
  const rollRef = useRef(0);
  const pitchRef = useRef(0);
  const tokens = useThemeTokens();

  /**
   * position on the *rendered* line at an arbitrary arc length, elevation exaggeration included.
   *
   * deriving the road under the car from the same geometry that is drawn, rather than from the
   * solver's grade channel, means the car cannot disagree with the surface it is sitting on:
   * whatever the exaggeration slider does to the road happens to the car for free.
   */
  const sampleAt = useMemo(() => {
    return (query: number, exag: number, out: THREE.Vector3) => {
      const loopM = line.loopLengthM;
      const s = ((query % loopM) + loopM) % loopM;
      const lo = lowerIndex(line.sM, s);
      const hi = Math.min(lo + 1, line.nPoints - 1);
      const f = (s - line.sM[lo]) / Math.max(line.sM[hi] - line.sM[lo], 1e-9);
      return out.set(
        line.positionYup[3 * lo] + f * (line.positionYup[3 * hi] - line.positionYup[3 * lo]),
        (line.positionYup[3 * lo + 1] +
          f * (line.positionYup[3 * hi + 1] - line.positionYup[3 * lo + 1])) *
          exag,
        line.positionYup[3 * lo + 2] +
          f * (line.positionYup[3 * hi + 2] - line.positionYup[3 * lo + 2]),
      );
    };
  }, [line]);

  const scratch = useMemo(
    () => ({ front: new THREE.Vector3(), rear: new THREE.Vector3(), probe: new THREE.Vector3() }),
    [],
  );

  const table = useMemo(
    () => buildLapTimeTable(line.sM, result.vMps, result.dlM),
    [line, result],
  );

  // scrub requests apply even while a different result is animating (table changes reset
  // nothing: sRef survives solver updates so the car doesn't teleport on slider drags).
  // only the live car owns the shared progress fields: the ghost must not clobber them.
  useEffect(() => {
    if (progressRef && !ghost) progressRef.current.lapTimeS = table.lapTimeS;
  }, [table, progressRef, ghost]);

  useFrame(({ camera }, delta) => {
    if (!groupRef.current) return;

    const scrub = progressRef?.current.scrub;
    if (scrub && scrub.id !== lastScrubId.current) {
      sRef.current = scrub.s; // ghost jumps with the live car so comparisons restart aligned
      lastScrubId.current = scrub.id;
    }

    if (playing) {
      const tNow = timeAtS(table, line.sM, sRef.current);
      sRef.current = sAtTime(table, line.sM, tNow + Math.min(delta, 0.1) * speedMultiplier);
    }

    const s = sRef.current;
    const lo = lowerIndex(line.sM, s);
    const hi = Math.min(lo + 1, line.nPoints - 1);
    const f = (s - line.sM[lo]) / Math.max(line.sM[hi] - line.sM[lo], 1e-9);
    const x = line.positionYup[3 * lo] + f * (line.positionYup[3 * hi] - line.positionYup[3 * lo]);
    const y =
      line.positionYup[3 * lo + 1] +
      f * (line.positionYup[3 * hi + 1] - line.positionYup[3 * lo + 1]);
    const z =
      line.positionYup[3 * lo + 2] +
      f * (line.positionYup[3 * hi + 2] - line.positionYup[3 * lo + 2]);
    const roadY = y * exaggeration;
    groupRef.current.position.set(x, roadY, z);

    // keep the car legible at any zoom. distance is measured to the road point rather than to
    // the final ride height, which is fine (the lift is metres against a camera hundreds out)
    // and breaks what would otherwise be a circular dependency: ride height needs the scale.
    const dist = camera.position.distanceTo(groupRef.current.position);
    const scale = THREE.MathUtils.clamp(dist * SCALE_PER_METRE, SCALE_MIN, SCALE_MAX);
    groupRef.current.scale.setScalar(scale);

    // sit the car on its whole footprint, not on the single point under its centre. at 16x the
    // body spans ~74 m of road, and on anything steeper than flat the far end of it was ending
    // up under the surface: the car cleared the road where it touched and buried its nose.
    const halfLen = MODEL_HALF_LENGTH * scale;
    sampleAt(s + halfLen, exaggeration, scratch.front);
    sampleAt(s - halfLen, exaggeration, scratch.rear);
    let deckY = Math.max(roadY, scratch.front.y, scratch.rear.y);
    // the ends alone would still let a crest push through the middle of a long car
    for (const frac of [-0.5, 0.5]) {
      sampleAt(s + frac * halfLen, exaggeration, scratch.probe);
      deckY = Math.max(deckY, scratch.probe.y);
    }
    groupRef.current.position.y = deckY + CLEARANCE_PER_SCALE_M * scale;

    // pitch with the road. taken from the rendered line rather than from the solver's grade
    // channel, so it tracks whatever the elevation exaggeration slider is doing: at 3x the road
    // climbs three times as steeply on screen and the car has to climb with it, which is why
    // the old fixed-grade attempt looked broken and got switched off.
    const runM = Math.hypot(
      scratch.front.x - scratch.rear.x,
      scratch.front.z - scratch.rear.z,
    );
    const targetPitch = THREE.MathUtils.clamp(
      Math.atan2(scratch.front.y - scratch.rear.y, Math.max(runM, 1e-6)),
      -MAX_PITCH_RAD,
      MAX_PITCH_RAD,
    );
    pitchRef.current += (targetPitch - pitchRef.current) * Math.min(delta * 6, 1);
    groupRef.current.rotation.order = "YXZ"; // yaw about world up, then pitch about the car's own axis
    groupRef.current.rotation.x = pitchRef.current;
    // the beacon fades in only once the car itself has stopped being readable. Its scale has to
    // undo the car scaling above, or it inherits it and balloons to a couple of hundred metres
    // across: the ring is sized in real metres on the ground, not in car-lengths.
    if (beaconRef.current) {
      const t = THREE.MathUtils.clamp((dist - 900) / 1600, 0, 1);
      beaconRef.current.visible = !ghost && t > 0.01;
      const outerM = 26 + t * 34;
      beaconRef.current.scale.setScalar(outerM / (BEACON_OUTER * scale));
      (beaconRef.current.material as THREE.MeshBasicMaterial).opacity = t * 0.5;
      // undo the parent's pitch so the ring stays flat on the ground: it is a map marker, and a
      // tilted one reads as part of the car rather than as a position on the circuit
      beaconRef.current.rotation.x = -Math.PI / 2 - pitchRef.current;
    }
    // same counter-pitch for the contact shadow, so it stays flat on the road
    if (shadowRef.current) shadowRef.current.rotation.x = -Math.PI / 2 - pitchRef.current;

    // yaw from the ground-plane tangent. The -PI/2 puts the model's nose (local -z) on the
    // travel direction; pitch is applied above, about the car's own lateral axis.
    const ahead = (hi + 4) % (line.nPoints - 1);
    const dx = line.positionYup[3 * ahead] - x;
    const dz = line.positionYup[3 * ahead + 2] - z;
    groupRef.current.rotation.y = Math.atan2(-dz, dx) - Math.PI / 2;

    // body roll from the solved lateral acceleration. Unlike pitch this is a real signal: it
    // leans out of the corner exactly where the friction circle is loaded.
    const ay = result.ayMps2[lo] + f * (result.ayMps2[hi] - result.ayMps2[lo]);
    const targetRoll = THREE.MathUtils.clamp(ay / 22, -1, 1) * MAX_ROLL_RAD;
    rollRef.current += (targetRoll - rollRef.current) * Math.min(delta * 6, 1);
    if (bodyRef.current) bodyRef.current.rotation.z = rollRef.current;

    // brake discs glow where the solver says the car is braking
    if (discRef.current && !ghost) {
      const braking = result.phase[lo] === PHASE_BRAKE;
      const target = braking ? 2.4 : 0;
      discRef.current.emissiveIntensity +=
        (target - discRef.current.emissiveIntensity) * Math.min(delta * 8, 1);
    }

    if (!ghost && progressRef) {
      const vNow = result.vMps[lo] + f * (result.vMps[hi] - result.vMps[lo]);
      progressRef.current.sM = s;
      progressRef.current.vMps = vNow;
      progressRef.current.tS = timeAtS(table, line.sM, s);
    }
    if (!ghost && poseRef) {
      // the chase camera follows the car's actual ride height, not the road point, or it dips
      // through the surface every time the car climbs
      poseRef.current.position.copy(groupRef.current.position);
      const len = Math.hypot(dx, dz);
      if (len > 1e-6) poseRef.current.direction.set(dx / len, 0, dz / len);
    }
  });

  const g = useCarGeometry();

  // ghost: one neutral translucent material for everything, so it reads as a reference shape
  // rather than a second car competing for attention
  const ghostMat = { color: MATERIAL.ghost, transparent: true, opacity: 0.28, roughness: 0.65 } as const;
  const paint = ghost
    ? ghostMat
    : ({ color: tokens.carBody, roughness: 0.32, metalness: 0.2 } as const);
  const carbon = ghost
    ? ghostMat
    : ({ color: tokens.carCarbon, roughness: 0.55, metalness: 0.35 } as const);
  const glass = ghost
    ? ghostMat
    : ({ color: tokens.carGlass, roughness: 0.12, metalness: 0.85 } as const);

  return (
    <group ref={groupRef}>
      {/* contact shadow.
          The car had none: it carried a castShadow prop, but no light in the scene casts and the
          renderer's shadow map is never enabled, so the prop was a no-op and the car floated a
          few centimetres above its own reflection. A directional shadow map is the wrong fix at
          this scale (2048 over a 4 km circuit is 2 m a texel, per DESIGN_NOTES 0.2b) and the blob
          texture built for exactly this had been sitting in textures.ts unreferenced. One quad,
          one draw, and it is what puts the car *on* the road rather than near it.
          Counter-pitched like the beacon: a shadow that tilts with the body reads as part of the
          car instead of as a mark on the ground. */}
      <mesh ref={shadowRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} renderOrder={-1}>
        <planeGeometry args={[3.6, 5.4]} />
        <meshBasicMaterial
          map={blobShadowAlpha()}
          transparent
          opacity={ghost ? 0.18 : 0.55}
          depthWrite={false}
          color="#000000"
        />
      </mesh>

      {/* ground beacon: a flat ring under the car, faded in by distance so it is invisible in
          the chase shots and unmissable when the whole circuit is in frame */}
      <mesh ref={beaconRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} visible={false}>
        <ringGeometry args={[4.05, BEACON_OUTER, 40]} />
        <meshBasicMaterial
          color={tokens.accent}
          transparent
          opacity={0}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <group ref={bodyRef}>
        {/* main shell: extruded side profile, wide-body proportions */}
        <mesh geometry={g.shell} castShadow>
          <meshStandardMaterial {...paint} />
        </mesh>

        {/* wheel arch flares. The torus is built in its local XY plane, so it has to be
            rotated about Y to stand up over a wheel on the x axis: rotating about Z instead
            laid it flat against the flank, which is the black arc that used to hang off the
            side of the car. */}
        {g.archPositions.map((p, i) => (
          <mesh key={i} geometry={g.arch} position={p} rotation={[0, Math.PI / 2, 0]}>
            <meshStandardMaterial {...paint} />
          </mesh>
        ))}

        {/* greenhouse: cabin glazing, narrower than the body so the roofline reads */}
        <mesh geometry={g.greenhouse} position={[0, 0.9, 0.1]}>
          <meshStandardMaterial {...glass} />
        </mesh>
        {/* roof scoop */}
        <mesh position={[0, 1.2, 0.2]}>
          <boxGeometry args={[0.34, 0.1, 0.8]} />
          <meshStandardMaterial {...carbon} />
        </mesh>

        {/* splitter with dive planes */}
        <mesh position={[0, 0.11, -2.24]}>
          <boxGeometry args={[2.02, 0.05, 0.62]} />
          <meshStandardMaterial {...carbon} />
        </mesh>
        {[-0.86, 0.86].map((sx) => (
          <mesh key={sx} position={[sx, 0.3, -2.0]} rotation={[0.22, 0, 0]}>
            <boxGeometry args={[0.24, 0.02, 0.34]} />
            <meshStandardMaterial {...carbon} />
          </mesh>
        ))}

        {/* side skirts */}
        {[-0.92, 0.92].map((sx) => (
          <mesh key={sx} position={[sx, 0.2, 0]}>
            <boxGeometry args={[0.09, 0.14, 2.5]} />
            <meshStandardMaterial {...carbon} />
          </mesh>
        ))}

        {/* mirrors on stalks */}
        {[-0.96, 0.96].map((sx) => (
          <group key={sx} position={[sx, 0.78, -0.6]}>
            <mesh>
              <boxGeometry args={[0.26, 0.03, 0.04]} />
              <meshStandardMaterial {...carbon} />
            </mesh>
            <mesh position={[sx > 0 ? 0.15 : -0.15, 0.04, 0]}>
              <boxGeometry args={[0.1, 0.12, 0.16]} />
              <meshStandardMaterial {...paint} />
            </mesh>
          </group>
        ))}

        {/* rear diffuser */}
        <mesh position={[0, 0.16, 2.1]} rotation={[-0.2, 0, 0]}>
          <boxGeometry args={[1.86, 0.06, 0.46]} />
          <meshStandardMaterial {...carbon} />
        </mesh>

        {/* swan-neck rear wing: plane, endplates, and the two pylons that hang it from above */}
        <mesh position={[0, 1.22, 2.02]} rotation={[0.14, 0, 0]}>
          <boxGeometry args={[1.84, 0.04, 0.42]} />
          <meshStandardMaterial {...carbon} />
        </mesh>
        {[-0.92, 0.92].map((sx) => (
          <mesh key={sx} position={[sx, 1.16, 2.02]}>
            <boxGeometry args={[0.03, 0.34, 0.56]} />
            <meshStandardMaterial {...carbon} />
          </mesh>
        ))}
        {[-0.42, 0.42].map((sx) => (
          <mesh key={sx} position={[sx, 1.09, 1.9]}>
            <boxGeometry args={[0.05, 0.3, 0.1]} />
            <meshStandardMaterial {...carbon} />
          </mesh>
        ))}

        {!ghost && (
          <>
            {/* livery: a single stripe over the spine plus a number roundel on each door */}
            <mesh position={[0, 1.02, -0.3]}>
              <boxGeometry args={[0.22, 0.02, 2.2]} />
              <meshStandardMaterial color={tokens.accentContrast} roughness={0.4} />
            </mesh>
            {[-0.94, 0.94].map((sx) => (
              <mesh key={sx} position={[sx, 0.62, 0.1]} rotation={[0, Math.PI / 2, 0]}>
                <circleGeometry args={[0.26, 20]} />
                <meshStandardMaterial
                  color={tokens.accentContrast}
                  roughness={0.5}
                  side={THREE.DoubleSide}
                />
              </mesh>
            ))}

            {/* headlights and a full-width taillight bar */}
            {[-0.64, 0.64].map((sx) => (
              <mesh key={sx} position={[sx, 0.5, -2.2]}>
                <boxGeometry args={[0.44, 0.12, 0.06]} />
                <meshStandardMaterial
                  color={MATERIAL.headlight}
                  emissive={MATERIAL.headlightEmissive}
                  emissiveIntensity={2.4}
                />
              </mesh>
            ))}
            <mesh position={[0, 0.66, 2.2]}>
              <boxGeometry args={[1.5, 0.07, 0.04]} />
              <meshStandardMaterial color={tokens.neg} emissive={tokens.neg} emissiveIntensity={1.8} />
            </mesh>
          </>
        )}
      </group>

      {/* wheels stay outside the rolling group: a real car's tyres keep contact with the road */}
      {g.wheelPositions.map(([wx, wz], i) => (
        <group key={i} position={[wx, 0.36, wz]} rotation={[0, 0, Math.PI / 2]}>
          <mesh geometry={g.tyre}>
            <meshStandardMaterial
              color={MATERIAL.tyre}
              roughness={0.9}
              transparent={ghost}
              opacity={ghost ? 0.28 : 1}
            />
          </mesh>
          <mesh position={[0, wx > 0 ? 0.13 : -0.13, 0]}>
            <cylinderGeometry args={[0.23, 0.23, 0.03, 16]} />
            <meshStandardMaterial
              color={MATERIAL.rim}
              roughness={0.25}
              metalness={0.85}
              transparent={ghost}
              opacity={ghost ? 0.28 : 1}
            />
          </mesh>
          {/* brake disc: emissive is driven per frame from the solved phase */}
          <mesh position={[0, wx > 0 ? 0.05 : -0.05, 0]}>
            <cylinderGeometry args={[0.19, 0.19, 0.035, 16]} />
            <meshStandardMaterial
              ref={i === 0 ? discRef : undefined}
              color={MATERIAL.brakeDisc}
              roughness={0.4}
              metalness={0.6}
              emissive={MATERIAL.brakeGlow}
              emissiveIntensity={0}
              transparent={ghost}
              opacity={ghost ? 0.28 : 1}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * The geometry is built once per module, not per car: the live car and the ghost share it, and
 * nothing here depends on props. Extruding along the car's width means the 2D profile below is
 * literally the side view, which makes the proportions easy to reason about.
 */
function useCarGeometry() {
  return useMemo(() => {
    // side profile, x = length with the nose at +x, y = height
    const profile = new THREE.Shape();
    profile.moveTo(2.24, 0.12);
    profile.lineTo(2.3, 0.3); // splitter lip
    profile.lineTo(2.16, 0.52); // nose
    profile.lineTo(1.5, 0.62); // bonnet
    profile.lineTo(0.62, 0.7); // windscreen base
    profile.lineTo(0.12, 1.12); // roof leading edge
    profile.lineTo(-0.82, 1.1); // roof trailing edge
    profile.lineTo(-1.72, 0.76); // fastback
    profile.lineTo(-2.16, 0.72); // rear deck
    profile.lineTo(-2.26, 0.44); // tail
    profile.lineTo(-2.2, 0.12);
    profile.closePath();

    // 1.72 wide plus a 0.1 bevel puts the flank at 0.96; the wheels below sit at 0.9 with a
    // 0.16 half-width, so the tyres stand 0.1 proud. At the previous 1.9 they were entirely
    // inside the bodywork and the car had no visible wheels at all.
    const shell = new THREE.ExtrudeGeometry(profile, {
      depth: 1.72,
      bevelEnabled: true,
      bevelThickness: 0.1,
      bevelSize: 0.1,
      bevelSegments: 3,
      curveSegments: 8,
    });
    // Extrude runs along +z from 0. rotateY(PI/2) maps (x, y, z) -> (z, y, -x), so the profile's
    // length ends up on world z with the nose at -z, and the extrusion depth (the car's width)
    // ends up on world x spanning 0..1.9. That is the axis that needs centring: translating z
    // instead shifted the whole body 0.95 m along its own length and left it hanging off its
    // wheels, which is why it read as a slab rather than a car.
    shell.rotateY(Math.PI / 2);
    shell.translate(-0.86, 0, 0);
    shell.computeVertexNormals();

    // wheel arch: a half torus, flattened, sitting proud of the bodywork
    const arch = new THREE.TorusGeometry(0.46, 0.1, 6, 14, Math.PI);
    arch.scale(1, 1, 0.5);

    const greenhouse = new THREE.BoxGeometry(1.5, 0.32, 1.46);
    const tyre = new THREE.CylinderGeometry(0.36, 0.36, 0.32, 24);

    const wheelPositions: [number, number][] = [
      [-0.9, -1.45],
      [0.9, -1.45],
      [-0.9, 1.45],
      [0.9, 1.45],
    ];
    const archPositions: [number, number, number][] = wheelPositions.map(([wx, wz]) => [
      wx > 0 ? 0.9 : -0.9,
      0.36,
      wz,
    ]);

    return { shell, arch, greenhouse, tyre, wheelPositions, archPositions };
  }, []);
}
