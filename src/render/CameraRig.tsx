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
import type { Terrain } from "../assets";
import { cameraLeashM, leashScale } from "./cameraLeash";
import { terrainAnchorXz } from "./terrainGrid";
import { fitDistance, type Viewpoint } from "./viewpoints";

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
  /** the racing line's bounding box, for the orbit's own fit. See the note at the orbit. */
  fitCorners: readonly (readonly [number, number, number])[];
  /** only for its anchor: the camera is leashed to the centre of the terrain field. */
  terrain: Terrain;
  carPoseRef: React.MutableRefObject<{ position: THREE.Vector3; direction: THREE.Vector3 }>;
  onUserTakeover?: () => void;
}

export function CameraRig({
  viewpoint,
  orbiting,
  reducedMotion,
  center,
  extent,
  fitCorners,
  terrain,
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

  // the terrain field's centre, and how far from it this camera may get. Both are defined outside
  // this file so the fade and the leash cannot drift apart; cameraLeash.ts carries the argument
  // for why OrbitControls' maxDistance was not enough on its own.
  const anchor = useMemo(() => terrainAnchorXz(terrain), [terrain]);
  const leash = cameraLeashM(extent);

  /**
   * pull `pos` back onto the leash circle, translating `target` by the same vector. Moving the
   * pair together is deliberate: OrbitControls rebuilds its spherical state from
   * (position - target) on every update(), so an equal translation is invisible to it, while
   * correcting only the camera would be a fight it wins the next frame. Returns whether it bit.
   */
  const clampToLeash = (pos: THREE.Vector3, target: THREE.Vector3): boolean => {
    const k = leashScale(pos.x - anchor.x, pos.z - anchor.z, leash);
    if (k === 1) return false;
    const cx = (pos.x - anchor.x) * (1 - k);
    const cz = (pos.z - anchor.z) * (1 - k);
    pos.x -= cx;
    pos.z -= cz;
    target.x -= cx;
    target.z -= cz;
    return true;
  };

  const flyTo = (to: THREE.Vector3, toTarget: THREE.Vector3) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const toPos = to.clone();
    const toEnd = toTarget.clone();
    // clamping the destination is the whole flight: the leash region is a disc, the xz projection
    // of a lerp is the lerp of the projections, and the departure point is inside already (every
    // other branch keeps it there). So the tween branch below needs no clamp of its own.
    clampToLeash(toPos, toEnd);
    tween.current = {
      fromPos: camera.position.clone(),
      toPos,
      fromTarget: controls.target.clone(),
      toTarget: toEnd,
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
      // a ray aimed near the horizon meets the ground plane arbitrarily far out, so a grazing
      // double-click reads as "fly to a point kilometres outside the world". flyTo would clamp
      // the camera anyway; pulling the hit in first is what keeps the framing sane when it does.
      const kHit = leashScale(hit.x - anchor.x, hit.z - anchor.z, leash);
      hit.x = anchor.x + (hit.x - anchor.x) * kHit;
      hit.z = anchor.z + (hit.z - anchor.z) * kHit;
      const offset = camera.position.clone().sub(controls.target);
      flyTo(hit.clone().add(offset), hit);
    };
    canvas.addEventListener("dblclick", onDblClick);
    return () => canvas.removeEventListener("dblclick", onDblClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera, carPoseRef, reducedMotion, anchor, leash]);

  useFrame((_, rawDelta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const delta = Math.min(rawDelta, 0.1); // a tab-switch stall must not launch the camera

    // 1. landing: slow automatic orbit, ignores everything else
    if (orbiting) {
      if (!reducedMotion) orbitAngle.current += delta * 0.045;
      const a = orbitAngle.current;
      // framed for the sheet's diagram plate, not for the window, and **the distance is solved
      // rather than chosen**. ViewOffset has already told the camera to compose inside the plate;
      // the job here is standing where the circuit fills it.
      //
      // This used to be a hand-tuned `extent * 0.55`, tuned against the desktop plate, which is a
      // wide short band at about 2.9:1. The plate on a phone is nearly square at about 1.04:1,
      // where the same distance has far less horizontal field to work with, and the circuit ran
      // off both edges. It is the same defect the static viewpoints had, in the one path that did
      // not go through them.
      //
      // camera.aspect is the plate's aspect, not the canvas's, because ViewOffset re-asserts it
      // every frame. So the fit reads it live and follows the plate through a resize or a scroll
      // with nothing plumbed.
      //
      // The look-at used to be pushed sideways by extent * 0.28, to keep the circuit clear of
      // hero copy that ran across it. Nothing runs across it now. The figure is centred in its
      // own frame, which is what a figure does.
      //
      // Margin is tighter than the viewer's, because the plate draws no corner labels and so
      // needs none of the headroom they ask for.
      const cam = camera as THREE.PerspectiveCamera;
      const elevation = 0.38 / 0.55; // the orbit's rise over its run, kept from the old pose
      const dir: [number, number, number] = [Math.cos(a), elevation, Math.sin(a)];
      const d = fitDistance(fitCorners, center, dir, cam.fov, cam.aspect, 1.06);
      const dl = Math.hypot(dir[0], dir[1], dir[2]);
      camera.position.set(
        center[0] + (dir[0] / dl) * d,
        center[1] + (dir[1] / dl) * d,
        center[2] + (dir[2] / dl) * d,
      );
      controls.target.set(center[0], 0, center[2]);
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

    // **the leash**, and the only place it is enforced continuously. Both ways of translating the
    // camera and its target together land in this branch: the WASD block above, and
    // OrbitControls' own right-drag pan, since this runs every frame whether a key is down or
    // not. Neither changes the camera-to-target distance maxDistance guards. Without this the
    // pair walks off the terrain field and the occluder's straight edge comes back. See
    // cameraLeash.ts.
    if (clampToLeash(camera.position, controls.target)) {
      // bleed off the outward part of the pan velocity too. Left in, it keeps accumulating
      // against a boundary it cannot cross, and releasing the key then buys a moment of nothing
      // happening while the decay works through it: the wall feels mushy instead of solid.
      const ox = camera.position.x - anchor.x;
      const oz = camera.position.z - anchor.z;
      const len = Math.hypot(ox, oz);
      if (len > 0) {
        const outward = (panVel.current.x * ox + panVel.current.z * oz) / len;
        if (outward > 0) {
          panVel.current.x -= (outward * ox) / len;
          panVel.current.z -= (outward * oz) / len;
        }
      }
    }
  });

  const dynamic = viewpoint.kind === "follow" || viewpoint.kind === "chase";

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={!dynamic && !orbiting}
      makeDefault
      minDistance={12}
      // the same radius as the leash, so zooming out cannot reach anywhere free-look is not
      // allowed to stand either. This alone is *not* what protects the terrain fade: it only caps
      // camera-to-target, and everything else here moves the two together. Keeping the two
      // numbers equal keeps the envelope one shape rather than two. See fieldRadii() in
      // terrainGrid.ts for the radius this has to stay inside.
      maxDistance={leash}
      maxPolarAngle={Math.PI * 0.495}
      enableDamping={!reducedMotion}
      dampingFactor={0.075}
      rotateSpeed={0.75}
      zoomSpeed={0.9}
    />
  );
}
