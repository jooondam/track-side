// everything trackside: braking boards, turn signs, structures, fence posts and tree lines.
//
// Three principles, all of them about draw calls rather than about looks:
//
//   1. **Boards and signs are two draw calls, not two hundred.** One InstancedMesh for the post,
//      one for the panel, and the panel material samples a single atlas with a per-instance UV
//      offset. Real numerals, no image files, and the atlas physically cannot render anything
//      except the sixteen faces in it, which is how the section 5 licensing rule stays true.
//   2. **Fences, marshal posts and trees are derived, not authored.** Walking the boundary
//      polyline at a fixed pitch gives ~700 fence posts at Spa from zero lines of data. Authoring
//      those by hand would be absurd and would rot the moment the geometry is regenerated.
//   3. **LOD is distance-banded visibility, not <Detailed>.** <Detailed> is per object and does
//      not compose with instancing at all. One useFrame toggles group.visible across three bands
//      with hysteresis, mirroring the fade logic the old terrain field already used.

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CircuitAssets, Landmarks as LandmarkData } from "../assets";
import { BOARD_ATLAS_COLUMNS, BOARD_ATLAS_ROWS, boardAtlas, boardFaceIndex, treeCanopy } from "./textures";
import { buildStructure, type Placement } from "./structures/generators";

// visibility bands, in metres of camera **altitude above the circuit**, with hysteresis so a
// group cannot flicker when the camera sits exactly on a threshold.
//
// Altitude, not distance: the circuit's coordinates sit thousands of metres from the world
// origin, so camera.position.length() is a number about the frame, not about the scene, and
// using it kept every band switched off everywhere. Altitude is also what the old terrain field
// faded on, so the bands and the ground agree about what "close" means.
const BAND_MID_M = 900;
const BAND_NEAR_M = 260;
const HYSTERESIS_M = 60;

const FENCE_PITCH_M = 20;
const FENCE_OUTBOARD_M = 9;
const FENCE_HEIGHT_M = 2.6;
const TREE_PITCH_M = 14;

const BOARD_POST_H = 1.5;
const BOARD_PANEL = 1.15;

interface LandmarksProps {
  assets: CircuitAssets;
  exaggeration: number;
}

/** interpolate the racing line's position and ground-plane tangent at an arc length. */
function sampleLine(assets: CircuitAssets, s: number): Placement {
  const line = assets.line;
  const n = line.nPoints;
  const loop = line.loopLengthM;
  const q = ((s % loop) + loop) % loop;
  let i = Math.min(Math.max(Math.round((q / loop) * (n - 1)), 0), n - 1);
  while (i > 0 && line.sM[i] > q) i--;
  while (i < n - 2 && line.sM[i + 1] < q) i++;
  const j = Math.min(i + 1, n - 1);
  const f = (q - line.sM[i]) / Math.max(line.sM[j] - line.sM[i], 1e-9);

  const x = line.positionYup[3 * i] + f * (line.positionYup[3 * j] - line.positionYup[3 * i]);
  const y =
    line.positionYup[3 * i + 1] + f * (line.positionYup[3 * j + 1] - line.positionYup[3 * i + 1]);
  const z =
    line.positionYup[3 * i + 2] + f * (line.positionYup[3 * j + 2] - line.positionYup[3 * i + 2]);

  const ahead = (j + 6) % (n - 1);
  let tx = line.positionYup[3 * ahead] - x;
  let tz = line.positionYup[3 * ahead + 2] - z;
  const len = Math.max(Math.hypot(tx, tz), 1e-6);
  tx /= len;
  tz /= len;
  return { x, y, z, tx, tz };
}

/** every board and turn sign on the circuit, as flat instance data. */
function boardInstances(landmarks: LandmarkData, assets: CircuitAssets) {
  const out: { p: Placement; side: number; face: string }[] = [];
  for (const corner of landmarks.corners) {
    const side = corner.boardSide === "left" ? 1 : -1;
    for (const board of corner.boards) {
      const face = String(board.distanceM);
      if (boardFaceIndex(face) < 0) continue;
      out.push({ p: sampleLine(assets, board.sM), side, face });
    }
    // one turn sign at the corner itself, if the number has a numeral in the atlas
    const numberFace = String(corner.number);
    if (boardFaceIndex(numberFace) >= 0) {
      out.push({ p: sampleLine(assets, corner.turnInSM), side, face: numberFace });
    }
  }
  return out;
}

export function Landmarks({ assets, exaggeration }: LandmarksProps) {
  const midRef = useRef<THREE.Group>(null);
  const nearRef = useRef<THREE.Group>(null);
  const shown = useRef({ mid: true, near: true });

  const boards = useMemo(() => boardInstances(assets.landmarks, assets), [assets]);

  // the circuit's mean elevation, in rendered units, so the bands measure height above the road
  // rather than height above sea level
  const groundY = useMemo(() => {
    let sum = 0;
    for (let i = 0; i < assets.line.nPoints; i++) sum += assets.line.positionYup[3 * i + 1];
    return (sum / assets.line.nPoints) * exaggeration;
  }, [assets, exaggeration]);

  // merged static structures: one geometry, one draw call, for the whole circuit
  const structures = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (const s of assets.landmarks.structures) {
      const placement =
        s.placement === "track" && s.sM !== undefined
          ? (() => {
              const base = sampleLine(assets, s.sM);
              // offset_m is signed from the centreline; the left normal is (-tz, tx)
              return {
                ...base,
                x: base.x + -base.tz * s.offsetM,
                z: base.z + base.tx * s.offsetM,
              };
            })()
          : null;
      const geometry = buildStructure(s, placement);
      if (geometry) parts.push(geometry);
    }
    return parts.length ? mergeGeometries(parts, false) : null;
  }, [assets]);

  // fence posts, walked off the boundary polyline rather than authored
  const fence = useMemo(() => {
    const lines = assets.trackLines;
    const matrices: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();
    for (const source of [lines.boundaryLeft, lines.boundaryRight]) {
      const count = source.length / 3;
      const step = Math.max(1, Math.round(FENCE_PITCH_M));
      for (let i = 0; i < count - 1; i += step) {
        const x = source[3 * i];
        const y = source[3 * i + 1];
        const z = source[3 * i + 2];
        const nx = source[3 * Math.min(i + step, count - 1)] - x;
        const nz = source[3 * Math.min(i + step, count - 1) + 2] - z;
        const len = Math.max(Math.hypot(nx, nz), 1e-6);
        // outboard is the left normal of the travel direction, pushed away from the road
        const ox = (-nz / len) * FENCE_OUTBOARD_M * (source === lines.boundaryLeft ? 1 : -1);
        const oz = (nx / len) * FENCE_OUTBOARD_M * (source === lines.boundaryLeft ? 1 : -1);
        dummy.position.set(x + ox, y + FENCE_HEIGHT_M / 2, z + oz);
        dummy.rotation.set(0, Math.atan2(-nz, nx), 0);
        dummy.updateMatrix();
        matrices.push(dummy.matrix.clone());
      }
    }
    return matrices;
  }, [assets]);

  // tree lines, one instance per pitch along each authored run
  const trees = useMemo(() => {
    const matrices: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();
    for (const s of assets.landmarks.structures) {
      if (s.kind !== "tree_line" || s.sM === undefined) continue;
      const count = Math.max(2, Math.round(s.lengthM / TREE_PITCH_M));
      for (let i = 0; i < count; i++) {
        const base = sampleLine(assets, s.sM - s.lengthM / 2 + (i * s.lengthM) / count);
        // deterministic jitter so a tree line is irregular but identical on every load
        const wobble = ((i * 2654435761) >>> 20) / 4096 - 0.5;
        const offset = s.offsetM + wobble * 12;
        const scale = 7 + (((i * 40503) >>> 8) % 100) / 25;
        dummy.position.set(base.x + -base.tz * offset, base.y + scale / 2, base.z + base.tx * offset);
        dummy.scale.set(scale, scale, scale);
        dummy.rotation.set(0, wobble * 3.1, 0);
        dummy.updateMatrix();
        matrices.push(dummy.matrix.clone());
      }
    }
    return matrices;
  }, [assets]);

  // per-instance atlas cell, consumed by the shader patch below
  const boardUv = useMemo(() => {
    const data = new Float32Array(boards.length * 2);
    boards.forEach((b, i) => {
      const cell = boardFaceIndex(b.face);
      data[2 * i] = (cell % BOARD_ATLAS_COLUMNS) / BOARD_ATLAS_COLUMNS;
      data[2 * i + 1] =
        1 - (Math.floor(cell / BOARD_ATLAS_COLUMNS) + 1) / BOARD_ATLAS_ROWS;
    });
    return new THREE.InstancedBufferAttribute(data, 2);
  }, [boards]);

  const panelMaterial = useMemo(() => {
    const material = new THREE.MeshStandardMaterial({
      map: boardAtlas(),
      roughness: 0.75,
      side: THREE.DoubleSide,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 aAtlas;\nvarying vec2 vAtlas;")
        .replace("#include <uv_vertex>", "#include <uv_vertex>\nvAtlas = aAtlas;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vAtlas;")
        .replace(
          "#include <map_fragment>",
          `#ifdef USE_MAP
             vec2 atlasUv = vAtlas + vMapUv / vec2(${BOARD_ATLAS_COLUMNS}.0, ${BOARD_ATLAS_ROWS}.0);
             diffuseColor *= texture2D( map, atlasUv );
           #endif`,
        );
    };
    return material;
  }, []);

  useEffect(() => () => panelMaterial.dispose(), [panelMaterial]);

  const treeMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: treeCanopy(),
        transparent: true,
        alphaTest: 0.45,
        roughness: 1,
        side: THREE.DoubleSide,
      }),
    [],
  );
  useEffect(() => () => treeMaterial.dispose(), [treeMaterial]);

  // apply the instance matrices once the meshes exist
  const fenceRef = useRef<THREE.InstancedMesh>(null);
  const treeRef = useRef<THREE.InstancedMesh>(null);
  const postRef = useRef<THREE.InstancedMesh>(null);
  const panelRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const dummy = new THREE.Object3D();
    fence.forEach((m, i) => fenceRef.current?.setMatrixAt(i, m));
    if (fenceRef.current) fenceRef.current.instanceMatrix.needsUpdate = true;
    trees.forEach((m, i) => treeRef.current?.setMatrixAt(i, m));
    if (treeRef.current) treeRef.current.instanceMatrix.needsUpdate = true;

    boards.forEach((b, i) => {
      const ox = -b.p.tz * b.side * 11;
      const oz = b.p.tx * b.side * 11;
      const yaw = Math.atan2(-b.p.tz, b.p.tx);
      dummy.position.set(b.p.x + ox, b.p.y + BOARD_POST_H / 2, b.p.z + oz);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      postRef.current?.setMatrixAt(i, dummy.matrix);

      dummy.position.set(b.p.x + ox, b.p.y + BOARD_POST_H + BOARD_PANEL / 2, b.p.z + oz);
      dummy.updateMatrix();
      panelRef.current?.setMatrixAt(i, dummy.matrix);
    });
    if (postRef.current) postRef.current.instanceMatrix.needsUpdate = true;
    if (panelRef.current) panelRef.current.instanceMatrix.needsUpdate = true;
  }, [fence, trees, boards]);

  useFrame(({ camera }) => {
    const target = midRef.current;
    if (!target) return;
    const d = camera.position.y - groundY;
    // hysteresis: a band only flips once the camera is clearly past its threshold
    const midOn = shown.current.mid ? d < BAND_MID_M + HYSTERESIS_M : d < BAND_MID_M - HYSTERESIS_M;
    const nearOn = shown.current.near
      ? d < BAND_NEAR_M + HYSTERESIS_M
      : d < BAND_NEAR_M - HYSTERESIS_M;
    if (midOn !== shown.current.mid) {
      shown.current.mid = midOn;
      target.visible = midOn;
    }
    if (nearRef.current && nearOn !== shown.current.near) {
      shown.current.near = nearOn;
      nearRef.current.visible = nearOn;
    }
  });

  return (
    <group scale={[1, exaggeration, 1]}>
      {/* mid band: the big silhouettes, visible until the whole circuit is in frame */}
      <group ref={midRef}>
        {structures && (
          <mesh geometry={structures}>
            <meshStandardMaterial vertexColors roughness={0.85} metalness={0.05} />
          </mesh>
        )}
        <instancedMesh ref={treeRef} args={[undefined, undefined, Math.max(trees.length, 1)]} material={treeMaterial}>
          <planeGeometry args={[1, 1]} />
        </instancedMesh>
      </group>

      {/* near band: the detail you only see from the chase and corner shots */}
      <group ref={nearRef}>
        <instancedMesh ref={fenceRef} args={[undefined, undefined, Math.max(fence.length, 1)]}>
          <boxGeometry args={[0.12, FENCE_HEIGHT_M, 0.12]} />
          <meshStandardMaterial color="#4a4d52" roughness={0.8} metalness={0.2} />
        </instancedMesh>
        <instancedMesh ref={postRef} args={[undefined, undefined, Math.max(boards.length, 1)]}>
          <boxGeometry args={[0.1, BOARD_POST_H, 0.1]} />
          <meshStandardMaterial color="#3a3d42" roughness={0.8} />
        </instancedMesh>
        <instancedMesh
          ref={panelRef}
          args={[undefined, undefined, Math.max(boards.length, 1)]}
          material={panelMaterial}
        >
          <planeGeometry args={[BOARD_PANEL, BOARD_PANEL]}>
            <primitive object={boardUv} attach="attributes-aAtlas" />
          </planeGeometry>
        </instancedMesh>
      </group>
    </group>
  );
}
