// the rail and the dock are overlays on the canvas, so the frame the camera composes for is not
// the canvas: it is the rectangle the panels leave uncovered. Every fitted viewpoint was framing
// the circuit into the whole canvas and then having 40% of it covered up, which at 1024x700 with
// both panels open left a sliver of terrain and some corner labels floating over nothing.
//
// Correcting the poses would only fix the three fitted shots and leave follow, chase, the corner
// presets and free orbit still occluded. Correcting the projection fixes all of them at once.
//
// camera.setViewOffset(fullW, fullH, x, y, w, h) renders a (w x h) window of a (fullW x fullH)
// virtual image. Treat the *unoccluded* rectangle as the full virtual image and the canvas as a
// larger window onto it, offset back by the rail's width: the framing lands in the visible
// rectangle, and the extra scene that the wider window reveals falls behind the panels rather
// than cropping the circuit off the bottom.

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type * as THREE from "three";

export interface ViewInsets {
  /** pixels of canvas covered on the left by the rail */
  left: number;
  /** pixels of canvas covered at the bottom by the telemetry dock */
  bottom: number;
}

/** per-second approach rate, so the reframe rides along with the panel's own width/height
 *  transition instead of snapping while the panel is still sliding. */
const INSET_RATE = 11;

/** below this the difference is not worth a projection matrix rebuild */
const EPS_PX = 0.25;

export function ViewOffset({
  insets,
  reducedMotion,
}: {
  insets: ViewInsets;
  reducedMotion: boolean;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);

  const current = useRef({ left: insets.left, bottom: insets.bottom });
  // what is actually on the camera right now, so a frame that changes nothing costs two compares
  const applied = useRef({ left: -1, bottom: -1, w: -1, h: -1 });

  useEffect(() => {
    const cam = camera;
    return () => {
      cam.clearViewOffset();
      cam.updateProjectionMatrix();
    };
  }, [camera]);

  useFrame((_, dt) => {
    const c = current.current;
    if (reducedMotion) {
      c.left = insets.left;
      c.bottom = insets.bottom;
    } else {
      const k = 1 - Math.exp(-INSET_RATE * dt);
      c.left += (insets.left - c.left) * k;
      c.bottom += (insets.bottom - c.bottom) * k;
      // settle exactly, so a panel that finished opening stops rebuilding the matrix
      if (Math.abs(insets.left - c.left) < EPS_PX) c.left = insets.left;
      if (Math.abs(insets.bottom - c.bottom) < EPS_PX) c.bottom = insets.bottom;
    }

    const W = size.width;
    const H = size.height;
    const a = applied.current;
    // re-asserted every frame, not only when the insets change. r3f owns camera.aspect and
    // rewrites it from the canvas size; skipping the frames where our own inputs held still left
    // the render using r3f's aspect with our view offset still enabled, which is a different
    // frustum from the one <Html> projected labels through. That is what put corner names over
    // blank paper with their own road missing.
    a.left = c.left;
    a.bottom = c.bottom;
    a.w = W;
    a.h = H;

    // the visible rectangle. Clamped to 1px so a panel taller than the viewport, or a zero-size
    // canvas during a resize, cannot produce a degenerate frustum.
    const w = Math.max(W - c.left, 1);
    const h = Math.max(H - c.bottom, 1);

    // the base frustum is the visible rectangle's, not the canvas's. r3f owns camera.aspect and
    // rewrites it on resize, which is why this re-asserts whenever W or H changes.
    camera.aspect = w / h;
    if (c.left < EPS_PX && c.bottom < EPS_PX) {
      camera.clearViewOffset();
    } else {
      camera.setViewOffset(w, h, -c.left, 0, W, H);
    }
    camera.updateProjectionMatrix();
  });

  return null;
}
