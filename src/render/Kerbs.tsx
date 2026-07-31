// procedural red/white kerbs on the inside edge of each corner: contiguous spans where the
// centerline curvature exceeds a threshold, inside edge chosen by curvature's sign (positive
// kappa = turning toward the left boundary in this data's convention). Instanced: two draw
// calls total regardless of how many kerb segments a circuit has.

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { TrackLines } from "../assets";
import { MATERIAL } from "../ui/theme";

const KAPPA_THRESHOLD = 8e-3; // 1/m -> corners tighter than R=125 m get kerbs
const MIN_SPAN_M = 20;
const SEGMENT_PITCH_M = 4;
const KERB_WIDTH = 1.1;
const KERB_HEIGHT = 0.12;

interface KerbSpan {
  start: number;
  end: number;
  inside: "left" | "right";
}

function findCornerSpans(trackLines: TrackLines): KerbSpan[] {
  const spans: KerbSpan[] = [];
  const kappa = trackLines.centerlineKappa;
  const s = trackLines.centerlineSM;
  let start: number | null = null;
  let signSum = 0;
  for (let i = 0; i < trackLines.nPoints; i++) {
    const hot = Math.abs(kappa[i]) > KAPPA_THRESHOLD;
    if (hot && start === null) {
      start = i;
      signSum = 0;
    }
    if (hot) signSum += Math.sign(kappa[i]);
    if (!hot && start !== null) {
      if (s[i] - s[start] >= MIN_SPAN_M) {
        spans.push({ start, end: i, inside: signSum >= 0 ? "left" : "right" });
      }
      start = null;
    }
  }
  return spans;
}

export function Kerbs({ trackLines }: { trackLines: TrackLines }) {
  const redRef = useRef<THREE.InstancedMesh>(null);
  const whiteRef = useRef<THREE.InstancedMesh>(null);

  const placements = useMemo(() => {
    const spans = findCornerSpans(trackLines);
    const red: THREE.Matrix4[] = [];
    const white: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();

    for (const span of spans) {
      const edge = span.inside === "left" ? trackLines.boundaryLeft : trackLines.boundaryRight;
      let sAcc = 0;
      let parity = 0;
      const iStart = Math.max(span.start, 2);
      const iEnd = Math.min(span.end - 1, trackLines.nPoints - 3);
      for (let i = iStart; i < iEnd; i++) {
        const ds = trackLines.centerlineSM[i + 1] - trackLines.centerlineSM[i];
        sAcc += ds;
        if (sAcc < SEGMENT_PITCH_M) continue;
        sAcc = 0;

        const x = edge[3 * i];
        const y = edge[3 * i + 1];
        const z = edge[3 * i + 2];
        const dx = edge[3 * (i + 2)] - edge[3 * (i - 2)];
        const dz = edge[3 * (i + 2) + 2] - edge[3 * (i - 2) + 2];

        dummy.position.set(x, y + KERB_HEIGHT / 2, z);
        dummy.rotation.set(0, Math.atan2(-dz, dx), 0);
        dummy.updateMatrix();
        (parity % 2 === 0 ? red : white).push(dummy.matrix.clone());
        parity += 1;
      }
    }
    return { red, white };
  }, [trackLines]);

  useEffect(() => {
    for (const [ref, mats] of [
      [redRef, placements.red],
      [whiteRef, placements.white],
    ] as const) {
      const mesh = ref.current;
      if (!mesh) continue;
      for (let i = 0; i < mats.length; i++) mesh.setMatrixAt(i, mats[i]);
      mesh.count = mats.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }, [placements]);

  const maxCount = Math.max(placements.red.length, placements.white.length, 1);

  return (
    <>
      <instancedMesh ref={redRef} args={[undefined, undefined, maxCount]}>
        <boxGeometry args={[SEGMENT_PITCH_M * 0.95, KERB_HEIGHT, KERB_WIDTH]} />
        <meshStandardMaterial color={MATERIAL.kerbRed} roughness={0.7} />
      </instancedMesh>
      <instancedMesh ref={whiteRef} args={[undefined, undefined, maxCount]}>
        <boxGeometry args={[SEGMENT_PITCH_M * 0.95, KERB_HEIGHT, KERB_WIDTH]} />
        <meshStandardMaterial color={MATERIAL.kerbWhite} roughness={0.7} />
      </instancedMesh>
    </>
  );
}
