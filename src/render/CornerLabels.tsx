// floating corner-name labels placed by arc length: DESIGN_NOTES section 4 point 7's
// "visual credibility" item: named corners are what separate a circuit from a grey ribbon.
//
// These are map labels, not objects in the world, so they are drawn at a constant screen size.
// That immediately creates the problem every map has: at a shallow overview angle, corners that
// are a kilometre apart on the ground project a few pixels apart on screen and the names pile up
// on each other. So each frame the labels are projected to screen space, sorted near to far, and
// any label that would land within a bounding box of one already placed is hidden. Nearer labels
// win, which is the same rule cartographic labelling uses.

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { TrackLines } from "../assets";
import type { Corner } from "../assets";
import { useThemeTokens } from "../ui/theme";
import { sampleCenterline } from "./trackFrame";
import type { ViewInsets } from "./ViewOffset";

interface CornerLabelsProps {
  trackLines: TrackLines;
  corners: Corner[];
  exaggeration: number;
  /** the rail and dock cover part of the canvas, and a label under a panel is a label nobody
   *  reads: it has to be culled and its slot given to the next candidate. */
  insets: ViewInsets;
}

const MIN_GAP_PX = { x: 108, y: 22 };

export function CornerLabels({ trackLines, corners, exaggeration, insets }: CornerLabelsProps) {
  const tokens = useThemeTokens();
  const elements = useRef<(HTMLDivElement | null)[]>([]);
  const scratch = useMemo(() => new THREE.Vector3(), []);

  // corner.sM is a *centreline* arc length (see sampleCenterline). Resolving it on the racing
  // line, as this did, drifts by up to 16 m at Spa, which is enough to hang a corner's name over
  // the road after the corner.
  const placed = useMemo(
    () =>
      corners.map((corner) => {
        const frame = sampleCenterline(trackLines, corner.sM);
        return { name: corner.name, x: frame.x, y: frame.y, z: frame.z };
      }),
    [trackLines, corners],
  );

  useFrame(({ camera, size }) => {
    const shown: { x: number; y: number }[] = [];
    // <Html> is real DOM and cannot depth-test, so from a trackside camera a corner on the far
    // side of the circuit paints straight over the car in front of you. Once the camera drops to
    // track level, only nearby corners stay labelled; from above, everything is fair game.
    const lowCamera = camera.position.y < 90;
    const maxDepth = lowCamera ? 500 : Infinity;
    const projected = placed.map((label, i) => {
      scratch.set(label.x, label.y * exaggeration + 14, label.z);
      const depth = camera.position.distanceTo(scratch);
      scratch.project(camera);
      return {
        i,
        depth,
        // behind the camera projects to a mirrored point, so cull on w rather than trusting x/y
        onScreen: scratch.z < 1 && Math.abs(scratch.x) < 1 && Math.abs(scratch.y) < 1,
        x: ((scratch.x + 1) / 2) * size.width,
        y: ((1 - scratch.y) / 2) * size.height,
      };
    });

    projected.sort((a, b) => a.depth - b.depth);
    for (const p of projected) {
      const el = elements.current[p.i];
      if (!el) continue;
      // a label centred near the edge is drawn half outside the canvas, so require a margin.
      // The left and bottom margins start at the panels, not at the canvas: the projection is
      // already offset to compose into the same rectangle (see ViewOffset).
      const inset =
        p.x > insets.left + 70 &&
        p.x < size.width - 70 &&
        p.y > 12 &&
        p.y < size.height - insets.bottom - 12;
      const collides =
        !p.onScreen ||
        !inset ||
        p.depth > maxDepth ||
        shown.some(
          (s) => Math.abs(s.x - p.x) < MIN_GAP_PX.x && Math.abs(s.y - p.y) < MIN_GAP_PX.y,
        );
      el.style.opacity = collides ? "0" : "1";
      if (!collides) shown.push({ x: p.x, y: p.y });
    }
  });

  return (
    <>
      {placed.map((label, i) => (
        <Html
          key={label.name}
          position={[label.x, label.y * exaggeration + 14, label.z]}
          center
          zIndexRange={[5, 0]}
          style={{ pointerEvents: "none" }}
        >
          <div
            ref={(el) => {
              elements.current[i] = el;
            }}
            style={{
              color: tokens.textMuted,
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontFamily: "var(--font-display)",
              whiteSpace: "nowrap",
              // a halo in the scene's own background colour, so the label stays readable over both
              // the bright asphalt and the dark terrain in either theme
              textShadow: `0 0 7px ${tokens.sceneBg}, 0 0 7px ${tokens.sceneBg}, 0 0 3px ${tokens.sceneBg}`,
              transition: "opacity 160ms linear",
            }}
          >
            {label.name}
          </div>
        </Html>
      ))}
    </>
  );
}
