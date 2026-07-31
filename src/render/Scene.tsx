// the r3f scene: dark-telemetry composition of terrain grid, track mesh + outline + kerbs,
// racing line, braking markers, cars, labels, camera rig. Elevation exaggeration is applied
// as a Y scale on the track group; car markers and labels compensate internally.

import { Grid } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import { Perf } from "r3f-perf";
import * as THREE from "three";
import type { CircuitAssets } from "../assets";
import type { VelocityProfileResult } from "../solver/velocity";
import type { TrackDefinition } from "../tracks";
import { BrakingMarkers } from "./BrakingMarkers";
import { CameraRig, type CameraMode } from "./CameraRig";
import { CarMarker, type LapProgress } from "./CarMarker";
import { CornerLabels } from "./CornerLabels";
import { Kerbs } from "./Kerbs";
import { RacingLine, type ColorMode } from "./RacingLine";
import { TerrainGrid } from "./TerrainGrid";
import { TrackMesh } from "./TrackMesh";
import { TrackOutline } from "./TrackOutline";

interface SceneProps {
  assets: CircuitAssets;
  trackDef: TrackDefinition;
  result: VelocityProfileResult;
  ghostResult: VelocityProfileResult | null;
  colorMode: ColorMode;
  cameraMode: CameraMode;
  onCameraModeChange: (mode: CameraMode) => void;
  playing: boolean;
  speedMultiplier: number;
  exaggeration: number;
  showPerf: boolean;
  progressRef: React.MutableRefObject<LapProgress>;
  carPoseRef: React.MutableRefObject<{ position: THREE.Vector3; direction: THREE.Vector3 }>;
  onHoverIndex: (index: number | null) => void;
}

export function Scene({
  assets,
  trackDef,
  result,
  ghostResult,
  colorMode,
  cameraMode,
  onCameraModeChange,
  playing,
  speedMultiplier,
  exaggeration,
  showPerf,
  progressRef,
  carPoseRef,
  onHoverIndex,
}: SceneProps) {
  const { center, extent } = useMemo(() => {
    const p = assets.line.positionYup;
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < assets.line.nPoints; i++) {
      minX = Math.min(minX, p[3 * i]);
      maxX = Math.max(maxX, p[3 * i]);
      minZ = Math.min(minZ, p[3 * i + 2]);
      maxZ = Math.max(maxZ, p[3 * i + 2]);
    }
    return {
      center: [(minX + maxX) / 2, 0, (minZ + maxZ) / 2] as const,
      extent: Math.max(maxX - minX, maxZ - minZ),
    };
  }, [assets]);

  return (
    <Canvas
      camera={{
        position: [center[0], extent * 0.55, center[2] + extent * 0.7],
        far: extent * 10,
        near: 1,
      }}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#0a0a0f"]} />
      {/* fog pushed way out: at extent*1.2 it was swallowing the track colours the moment
          the camera pulled back -- depth cueing now comes from the terrain grid instead */}
      <fog attach="fog" args={["#0a0a0f", extent * 3, extent * 8]} />
      <hemisphereLight args={["#3a3a4a", "#0c0c10", 1.1]} />
      <directionalLight position={[center[0] + 600, 900, center[2] - 400]} intensity={1.4} />

      <Grid
        position={[center[0], -1.5, center[2]]}
        args={[extent * 3, extent * 3]}
        cellSize={100}
        cellColor="#16161e"
        sectionSize={500}
        sectionColor="#20202c"
        fadeDistance={extent * 2.2}
        infiniteGrid={false}
      />
      <TerrainGrid terrain={assets.terrain} exaggeration={exaggeration} />

      <Suspense fallback={null}>
        <group scale={[1, exaggeration, 1]}>
          <TrackMesh url={assets.glbUrl} />
          <TrackOutline trackLines={assets.trackLines} />
          <Kerbs trackLines={assets.trackLines} />
          <RacingLine
            line={assets.line}
            result={result}
            colorMode={colorMode}
            onHoverIndex={onHoverIndex}
          />
          <BrakingMarkers line={assets.line} result={result} />
        </group>
        <CarMarker
          line={assets.line}
          result={result}
          playing={playing}
          speedMultiplier={speedMultiplier}
          exaggeration={exaggeration}
          progressRef={progressRef}
          poseRef={carPoseRef}
        />
        {ghostResult && (
          <CarMarker
            line={assets.line}
            result={ghostResult}
            playing={playing}
            speedMultiplier={speedMultiplier}
            exaggeration={exaggeration}
            ghost
            progressRef={progressRef}
          />
        )}
        <CornerLabels line={assets.line} corners={trackDef.corners} exaggeration={exaggeration} />
      </Suspense>

      <CameraRig
        mode={cameraMode}
        onModeChange={onCameraModeChange}
        center={center}
        extent={extent}
        carPoseRef={carPoseRef}
      />
      {showPerf && <Perf position="top-right" />}
    </Canvas>
  );
}
