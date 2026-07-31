// the r3f scene: dark-telemetry composition of track mesh, racing line, car, labels.
// elevation exaggeration is applied as a Y scale on the track/line group; the car marker
// compensates internally so its body doesn't stretch.

import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import { Perf } from "r3f-perf";
import type { CircuitAssets } from "../assets";
import type { VelocityProfileResult } from "../solver/velocity";
import type { TrackDefinition } from "../tracks";
import { CarMarker } from "./CarMarker";
import { CornerLabels } from "./CornerLabels";
import { RacingLine, type ColorMode } from "./RacingLine";
import { TrackMesh } from "./TrackMesh";

interface SceneProps {
  assets: CircuitAssets;
  trackDef: TrackDefinition;
  result: VelocityProfileResult;
  colorMode: ColorMode;
  playing: boolean;
  speedMultiplier: number;
  exaggeration: number;
  showPerf: boolean;
  progressRef: React.MutableRefObject<{ sM: number; vMps: number }>;
  onHoverIndex: (index: number | null) => void;
}

export function Scene({
  assets,
  trackDef,
  result,
  colorMode,
  playing,
  speedMultiplier,
  exaggeration,
  showPerf,
  progressRef,
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
        far: extent * 6,
        near: 1,
      }}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#0a0a0f"]} />
      <fog attach="fog" args={["#0a0a0f", extent * 1.2, extent * 4]} />
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

      <Suspense fallback={null}>
        <group scale={[1, exaggeration, 1]}>
          <TrackMesh url={assets.glbUrl} />
          <RacingLine
            line={assets.line}
            result={result}
            colorMode={colorMode}
            onHoverIndex={onHoverIndex}
          />
        </group>
        <CarMarker
          line={assets.line}
          result={result}
          playing={playing}
          speedMultiplier={speedMultiplier}
          exaggeration={exaggeration}
          progressRef={progressRef}
        />
        <CornerLabels line={assets.line} corners={trackDef.corners} exaggeration={exaggeration} />
      </Suspense>

      <OrbitControls
        target={[center[0], 0, center[2]]}
        maxPolarAngle={Math.PI * 0.49}
        minDistance={60}
        maxDistance={extent * 2.5}
      />
      {showPerf && <Perf position="bottom-right" />}
    </Canvas>
  );
}
