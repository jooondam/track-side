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
import { BOARD_ATLAS_COLUMNS, BOARD_ATLAS_ROWS, boardAtlas, boardFaceIndex } from "./textures";
import { buildStructure } from "./structures/generators";
import {
  leftNormal,
  outboard,
  sampleBoundary,
  sampleCenterline,
  type Frame,
  type Side,
} from "./trackFrame";

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

// how far outboard of the road edge boards and signs stand. Real marker boards sit just past the
// verge, and 4 m clears the kerbs (1.1 m wide, on the edge) with room for the panel to overhang.
const BOARD_OUTBOARD_M = 4;

// **There are no trees.** tree_line structures stay in landmarks.json because they are real
// features of both circuits and the schema should keep recording them, but nothing renders
// them. What shipped was one instanced quad per tree that never billboarded, so from most
// angles it was a flat green card standing in a field, and the alpha-cut canopy texture read as
// a blob at every distance the LOD band allowed. Doing it properly means either crossed quads
// (still obviously cards in motion) or real geometry (a draw call and a triangle budget for
// scenery that carries no information about the racing line). Neither earns its place in a
// tool whose subject is the line, so the trees are gone and the fog and the terrain field do
// the work of suggesting depth instead.

const BOARD_POST_H = 1.5;
const BOARD_PANEL = 1.15;

interface LandmarksProps {
  assets: CircuitAssets;
  exaggeration: number;
}

/** ground height at a world point, taken from the nearest centreline sample. */
function groundYNear(assets: CircuitAssets, x: number, z: number): number {
  const c = assets.trackLines.centerline;
  let best = Infinity;
  let bestY = 0;
  for (let i = 0; i < assets.trackLines.nPoints; i++) {
    const d = (c[3 * i] - x) ** 2 + (c[3 * i + 2] - z) ** 2;
    if (d < best) {
      best = d;
      bestY = c[3 * i + 1];
    }
  }
  return bestY;
}

/**
 * every board and turn sign on the circuit, as flat instance data.
 *
 * Positions come off the **road edge**, not off the racing line. They used to be a flat 11 m
 * from the line, which put 5 of 141 markers on the racing surface at Spa, up to 4.58 m inside
 * the edge: the line is not the middle of the road, and at an apex 11 m from it crosses the
 * whole 9.8 m carriageway. See sampleBoundary in ./trackFrame.
 */
function boardInstances(landmarks: LandmarkData, assets: CircuitAssets) {
  const out: { frame: Frame; side: Side; face: string }[] = [];
  for (const corner of landmarks.corners) {
    const side: Side = corner.boardSide === "left" ? "left" : "right";
    for (const board of corner.boards) {
      const face = String(board.distanceM);
      if (boardFaceIndex(face) < 0) continue;
      out.push({ frame: sampleBoundary(assets.trackLines, board.sM, side), side, face });
    }
    // one turn sign at the corner itself, if the number has a numeral in the atlas
    const numberFace = String(corner.number);
    if (boardFaceIndex(numberFace) >= 0) {
      out.push({
        frame: sampleBoundary(assets.trackLines, corner.turnInSM, side),
        side,
        face: numberFace,
      });
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
      // a 'world' structure carries its own x and z, but not its height. Sampling the nearest
      // centreline point gives it the circuit's own ground level, which is what stops Monza's
      // banking being drawn at sea level and passing through a road that sits 6 m up.
      const worldPlacement =
        s.placement === "world" && s.polylineXz.length > 0
          ? (() => {
              const [cx, cz] = s.polylineXz.reduce(
                (acc, [x, z]) => [acc[0] + x / s.polylineXz.length, acc[1] + z / s.polylineXz.length],
                [0, 0],
              );
              return { x: 0, y: groundYNear(assets, cx, cz) * exaggeration, z: 0, tx: 1, tz: 0 };
            })()
          : null;

      const placement =
        s.placement === "track" && s.sM !== undefined
          ? (() => {
              // the centreline, not the racing line: offset_m is signed *from the centreline*
              // and s_m is a centreline arc length. Sampling the racing line put the near leg of
              // three of Spa's four gantries on the racing surface, worst 6.9 m inside it.
              const base = sampleCenterline(assets.trackLines, s.sM);
              // positive offset is to the driver's left. The old expression used (-tz, tx),
              // which is the *right* normal, so every offset structure stood on the wrong side.
              const [lx, lz] = leftNormal(base.tx, base.tz);
              return {
                ...base,
                x: base.x + lx * s.offsetM,
                y: base.y * exaggeration,
                z: base.z + lz * s.offsetM,
              };
            })()
          : worldPlacement;
      const geometry = buildStructure(s, placement);
      if (geometry) parts.push(geometry);
    }
    return parts.length ? mergeGeometries(parts, false) : null;
  }, [assets, exaggeration]);

  // fence posts, walked off the boundary polyline rather than authored.
  //
  // Two fixes here. The outboard sign was inverted, which pushed both rows *across* the road:
  // 463 of the ~700 posts at Spa stood on the racing surface, the deepest 7.55 m inside the
  // edge. And the pitch was applied as an index step, so it only meant 20 m because the
  // boundaries happen to be resampled at exactly 1.0 m; it now walks the arc length, which is
  // what the constant has always claimed to be.
  const fence = useMemo(() => {
    const lines = assets.trackLines;
    const matrices: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();
    const loop = lines.centerlineSM[lines.nPoints - 1];
    for (const side of ["left", "right"] as Side[]) {
      for (let s = 0; s < loop; s += FENCE_PITCH_M) {
        const frame = sampleBoundary(lines, s, side);
        const [px, pz] = outboard(frame, side, FENCE_OUTBOARD_M);
        dummy.position.set(px, frame.y * exaggeration + FENCE_HEIGHT_M / 2, pz);
        dummy.rotation.set(0, Math.atan2(-frame.tz, frame.tx), 0);
        dummy.updateMatrix();
        matrices.push(dummy.matrix.clone());
      }
    }
    return matrices;
  }, [assets, exaggeration]);

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

  // apply the instance matrices once the meshes exist
  const fenceRef = useRef<THREE.InstancedMesh>(null);
  const postRef = useRef<THREE.InstancedMesh>(null);
  const panelRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const dummy = new THREE.Object3D();
    fence.forEach((m, i) => fenceRef.current?.setMatrixAt(i, m));
    if (fenceRef.current) fenceRef.current.instanceMatrix.needsUpdate = true;

    boards.forEach((b, i) => {
      const [px, pz] = outboard(b.frame, b.side, BOARD_OUTBOARD_M);
      const yaw = Math.atan2(-b.frame.tz, b.frame.tx);
      const groundY = b.frame.y * exaggeration;
      dummy.position.set(px, groundY + BOARD_POST_H / 2, pz);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      postRef.current?.setMatrixAt(i, dummy.matrix);

      dummy.position.set(px, groundY + BOARD_POST_H + BOARD_PANEL / 2, pz);
      dummy.updateMatrix();
      panelRef.current?.setMatrixAt(i, dummy.matrix);
    });
    if (postRef.current) postRef.current.instanceMatrix.needsUpdate = true;
    if (panelRef.current) panelRef.current.instanceMatrix.needsUpdate = true;
  }, [fence, boards, exaggeration]);

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
    // **No Y scale on this group.** It used to carry scale={[1, exaggeration, 1]}, which stretched
    // the objects as well as their positions: at 3x elevation a 2.6 m fence post became a 7.8 m
    // pole and the pit building grew three storeys. Every placement above multiplies its own
    // ground height by exaggeration instead, so the furniture rides the exaggerated terrain at
    // life size. Same split CarMarker.tsx and CornerLabels.tsx already use.
    <group>
      {/* mid band: the big silhouettes, visible until the whole circuit is in frame */}
      <group ref={midRef}>
        {structures && (
          <mesh geometry={structures}>
            <meshStandardMaterial vertexColors roughness={0.85} metalness={0.05} />
          </mesh>
        )}
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
