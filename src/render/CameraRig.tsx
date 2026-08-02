// the camera director. Every camera change in the app goes through one eased tween: viewpoint
// jumps, double-click focus, and the handoff out of the landing orbit. Nothing else is allowed to
// assign camera.position, which is what stops the "cut" feeling the previous three-mode version
// had, and what makes a mid-flight user grab behave sanely (any orbit or pan input cancels the
// tween instead of fighting it).

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Viewpoint } from "./viewpoints";

const PAN_ACCEL = 900; // m/s^2, so panning eases in rather than snapping to full speed
const PAN_MAX = 260; // m/s at 1x
const PAN_DAMP = 6; // per second decay when no key is held
// standoffs are tuned for a life-size car (4.6 m long): a broadcast follow shot and a
// bumper-height chase
const FOLLOW = { back: 21, up: 7.5, lerp: 4 };
const CHASE = { back: 10, up: 2.6, lerp: 8 };
const TWEEN_S = 1.0;

function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return (
    !!t &&
    (t.tagName === "INPUT" ||
      t.tagName === "SELECT" ||
      t.tagName === "TEXTAREA" ||
      t.isContentEditable)
  );
}

// the same curve as --ease in theme.ts, close enough for a camera
function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

/** frame-rate independent lerp factor: a fixed alpha changes feel between 60 and 120 Hz. */
function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

interface CameraRigProps {
  viewpoint: Viewpoint;
  /** slow automatic orbit while the landing hero is up */
  orbiting: boolean;
  reducedMotion: boolean;
  center: readonly [number, number, number];
  extent: number;
  carPoseRef: React.MutableRefObject<{ position: THREE.Vector3; direction: THREE.Vector3 }>;
  onUserTakeover?: () => void;
}

export function CameraRig({
  viewpoint,
  orbiting,
  reducedMotion,
  center,
  extent,
  carPoseRef,
  onUserTakeover,
}: CameraRigProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const pressed = useRef<Set<string>>(new Set());
  const panVel = useRef(new THREE.Vector3());
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  const tween = useRef<{
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    t: number;
    duration: number;
  } | null>(null);

  const orbitAngle = useRef(0);
  const scratch = useMemo(
    () => ({ pos: new THREE.Vector3(), target: new THREE.Vector3(), move: new THREE.Vector3() }),
    [],
  );

  const flyTo = (to: THREE.Vector3, toTarget: THREE.Vector3) => {
    const controls = controlsRef.current;
    if (!controls) return;
    tween.current = {
      fromPos: camera.position.clone(),
      toPos: to.clone(),
      fromTarget: controls.target.clone(),
      toTarget: toTarget.clone(),
      t: 0,
      duration: reducedMotion ? 0.01 : TWEEN_S,
    };
  };

  // a viewpoint change starts a flight. Dynamic viewpoints (follow/chase) have no pose to fly to:
  // the per-frame branch below takes over and eases in on its own.
  useEffect(() => {
    if (orbiting) return;
    if (viewpoint.kind !== "static" || !viewpoint.position || !viewpoint.target) return;
    flyTo(
      new THREE.Vector3(...viewpoint.position),
      new THREE.Vector3(...viewpoint.target),
    );
    // flyTo is stable enough for this effect's purpose; re-running on camera identity is harmless
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewpoint, orbiting, reducedMotion]);

  // cancel an in-flight tween the moment the user grabs the camera
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const onStart = () => {
      if (tween.current) {
        tween.current = null;
        onUserTakeover?.();
      }
    };
    controls.addEventListener("start", onStart);
    return () => controls.removeEventListener("start", onStart);
  }, [onUserTakeover]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      pressed.current.add(e.key.toLowerCase());
    };
    const up = (e: KeyboardEvent) => pressed.current.delete(e.key.toLowerCase());
    const blur = () => pressed.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // double-click to focus: raycast the ground plane at track height, fly the target there while
  // holding the current viewing distance and angle
  useEffect(() => {
    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const onDblClick = (e: MouseEvent) => {
      const controls = controlsRef.current;
      if (!controls || !controls.enabled) return;
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -carPoseRef.current.position.y);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, hit)) return;
      const offset = camera.position.clone().sub(controls.target);
      flyTo(hit.clone().add(offset), hit);
    };
    canvas.addEventListener("dblclick", onDblClick);
    return () => canvas.removeEventListener("dblclick", onDblClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera, carPoseRef, reducedMotion]);

  useFrame((_, rawDelta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const delta = Math.min(rawDelta, 0.1); // a tab-switch stall must not launch the camera

    // 1. landing: slow automatic orbit, ignores everything else
    if (orbiting) {
      if (!reducedMotion) orbitAngle.current += delta * 0.045;
      const a = orbitAngle.current;
      // far enough back that the whole circuit fits in roughly 40% of the frame width, and high
      // enough that it reads as a shape rather than flattening into the horizon
      const r = extent * 0.8;
      camera.position.set(center[0] + Math.cos(a) * r, extent * 0.5, center[2] + Math.sin(a) * r);
      // push the look-at left of the circuit so the circuit renders right of centre, clear of the
      // hero copy. Screen-right for this orbit is (sin a, 0, -cos a), so the target moves against
      // it and follows the camera around.
      const off = extent * 0.28;
      controls.target.set(center[0] - Math.sin(a) * off, 0, center[2] + Math.cos(a) * off);
      controls.update();
      return;
    }

    // 2. an active flight owns the camera outright
    if (tween.current) {
      const tw = tween.current;
      tw.t = Math.min(tw.t + delta / tw.duration, 1);
      const e = easeOutQuint(tw.t);
      camera.position.copy(scratch.pos.copy(tw.fromPos).lerp(tw.toPos, e));
      controls.target.copy(scratch.target.copy(tw.fromTarget).lerp(tw.toTarget, e));
      controls.update();
      if (tw.t >= 1) tween.current = null;
      return;
    }

    // 3. the dynamic viewpoints
    if (viewpoint.kind === "follow" || viewpoint.kind === "chase") {
      const cfg = viewpoint.kind === "follow" ? FOLLOW : CHASE;
      const pose = carPoseRef.current;
      scratch.pos
        .copy(pose.position)
        .addScaledVector(pose.direction, -cfg.back)
        .setY(pose.position.y + cfg.up);
      camera.position.lerp(scratch.pos, damp(cfg.lerp, delta));
      controls.target.lerp(pose.position, damp(cfg.lerp * 1.5, delta));
      controls.update();
      return;
    }

    // 4. free look: WASD with acceleration and decay so panning has weight
    const keys = pressed.current;
    scratch.move.set(0, 0, 0);
    if (keys.size > 0) {
      const forward = camera.getWorldDirection(new THREE.Vector3());
      forward.y = 0;
      forward.normalize();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
      if (keys.has("w")) scratch.move.add(forward);
      if (keys.has("s")) scratch.move.sub(forward);
      if (keys.has("d")) scratch.move.add(right);
      if (keys.has("a")) scratch.move.sub(right);
      if (keys.has("e")) scratch.move.y += 1;
      if (keys.has("q")) scratch.move.y -= 1;
    }

    if (scratch.move.lengthSq() > 0) {
      const boost = keys.has("shift") ? 2.5 : 1;
      scratch.move.normalize().multiplyScalar(PAN_ACCEL * boost * delta);
      panVel.current.add(scratch.move).clampLength(0, PAN_MAX * boost);
    } else {
      panVel.current.multiplyScalar(1 - damp(PAN_DAMP, delta));
      if (panVel.current.lengthSq() < 0.01) panVel.current.set(0, 0, 0);
    }

    if (panVel.current.lengthSq() > 0) {
      scratch.move.copy(panVel.current).multiplyScalar(delta);
      controls.target.add(scratch.move);
      camera.position.add(scratch.move);
    }
    controls.update();
  });

  const dynamic = viewpoint.kind === "follow" || viewpoint.kind === "chase";

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={!dynamic && !orbiting}
      makeDefault
      minDistance={12}
      // **TerrainMesh depends on this cap.** Its point-and-wire field fades on a radius anchored
      // to the scene, not to the camera, and that is only safe because 2.5 extents (about 5.1 km
      // at Spa) keeps the camera inside the fade's outer radius (about 5.2 km). Raise this and
      // the heightfield's hard rectangular edge comes back into view. See fadeRadii() there.
      maxDistance={extent * 2.5}
      maxPolarAngle={Math.PI * 0.495}
      enableDamping={!reducedMotion}
      dampingFactor={0.075}
      rotateSpeed={0.75}
      zoomSpeed={0.9}
    />
  );
}
