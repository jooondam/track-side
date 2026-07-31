// camera control: three modes (free orbit + WASD pan, chase cam, top-down), map-editor
// keyboard scheme, double-click-to-focus. Keyboard events are ignored while a form control
// has focus so typing in the HUD never flies the camera.

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

export type CameraMode = "free" | "follow" | "top";

const PAN_SPEED = 220; // m/s at 1x
const FOLLOW_BACK = 28;
const FOLLOW_UP = 9;

function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA");
}

interface CameraRigProps {
  mode: CameraMode;
  onModeChange: (mode: CameraMode) => void;
  center: readonly [number, number, number];
  extent: number;
  // written per-frame by CarMarker: world position + unit travel direction of the live car
  carPoseRef: React.MutableRefObject<{ position: THREE.Vector3; direction: THREE.Vector3 }>;
}

export function CameraRig({ mode, onModeChange, center, extent, carPoseRef }: CameraRigProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const pressed = useRef<Set<string>>(new Set());
  const focusTween = useRef<{ from: THREE.Vector3; to: THREE.Vector3; t: number } | null>(null);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      const key = e.key.toLowerCase();
      pressed.current.add(key);
      if (key === "1") onModeChange("free");
      if (key === "2") onModeChange("follow");
      if (key === "3") onModeChange("top");
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
  }, [onModeChange]);

  // double-click to focus: raycast into the scene, tween the orbit target to the hit
  useEffect(() => {
    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const onDblClick = (e: MouseEvent) => {
      if (mode !== "free" || !controlsRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      // intersect the ground plane band around track height: robust without needing scene refs
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -carPoseRef.current.position.y);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, hit)) {
        focusTween.current = {
          from: controlsRef.current.target.clone(),
          to: hit,
          t: 0,
        };
      }
    };
    canvas.addEventListener("dblclick", onDblClick);
    return () => canvas.removeEventListener("dblclick", onDblClick);
  }, [gl, camera, mode, carPoseRef]);

  // snap camera when switching modes
  useEffect(() => {
    if (!controlsRef.current) return;
    const controls = controlsRef.current;
    if (mode === "top") {
      camera.position.set(center[0], extent * 1.15, center[2] + 1);
      controls.target.set(center[0], 0, center[2]);
    }
    if (mode === "free") {
      camera.position.set(center[0], extent * 0.55, center[2] + extent * 0.7);
      controls.target.set(center[0], 0, center[2]);
    }
    controls.update();
  }, [mode, camera, center, extent]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    if (mode === "follow") {
      const pose = carPoseRef.current;
      const desired = pose.position
        .clone()
        .addScaledVector(pose.direction, -FOLLOW_BACK)
        .add(new THREE.Vector3(0, FOLLOW_UP, 0));
      camera.position.lerp(desired, Math.min(delta * 4, 1));
      camera.lookAt(pose.position);
      return; // orbit controls disabled below
    }

    if (focusTween.current) {
      const tw = focusTween.current;
      tw.t = Math.min(tw.t + delta / 0.5, 1);
      const ease = 1 - Math.pow(1 - tw.t, 3);
      const next = tw.from.clone().lerp(tw.to, ease);
      const shift = next.clone().sub(controls.target);
      controls.target.copy(next);
      camera.position.add(shift);
      if (tw.t >= 1) focusTween.current = null;
    }

    const keys = pressed.current;
    if (keys.size > 0 && mode !== "top") {
      const speed = PAN_SPEED * (keys.has("shift") ? 2.5 : 1) * delta;
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      const rightDir = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));

      const move = new THREE.Vector3();
      if (keys.has("w")) move.add(forward);
      if (keys.has("s")) move.sub(forward);
      if (keys.has("d")) move.add(rightDir);
      if (keys.has("a")) move.sub(rightDir);
      if (keys.has("e")) move.y += 1;
      if (keys.has("q")) move.y -= 1;
      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(speed);
        controls.target.add(move);
        camera.position.add(move);
      }
    }
    controls.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={mode !== "follow"}
      target={[center[0], 0, center[2]]}
      maxPolarAngle={mode === "top" ? 0.15 : Math.PI * 0.49}
      minDistance={20}
      maxDistance={extent * 2.5}
      enableDamping={false}
    />
  );
}
