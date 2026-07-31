// the r3f scene: terrain, track mesh + outline + kerbs, racing line, braking markers, cars,
// labels, camera rig. Every colour and light level comes from the theme, so the toggle changes
// the whole composition rather than just the panels. Elevation exaggeration is applied as a Y
// scale on the track group; car markers and labels compensate internally.

import { Canvas } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import { Perf } from "r3f-perf";
import * as THREE from "three";
import type { CircuitAssets } from "../assets";
import type { VelocityProfileResult } from "../solver/velocity";
import type { TrackDefinition } from "../tracks";
import { useThemeTokens } from "../ui/theme";
import { BrakingMarkers } from "./BrakingMarkers";
import { CameraRig } from "./CameraRig";
import { CarMarker, type LapProgress } from "./CarMarker";
import { CornerLabels } from "./CornerLabels";
import { Kerbs } from "./Kerbs";
import { RacingLine, type ColorMode } from "./RacingLine";
import { TerrainGrid } from "./TerrainGrid";
import { TrackMesh } from "./TrackMesh";
import { TrackOutline } from "./TrackOutline";
import type { Viewpoint } from "./viewpoints";

interface SceneProps {
  assets: CircuitAssets;
  trackDef: TrackDefinition;
  result: VelocityProfileResult;
  ghostResult: VelocityProfileResult | null;
  colorMode: ColorMode;
  viewpoint: Viewpoint;
  orbiting: boolean;
  reducedMotion: boolean;
  playing: boolean;
  speedMultiplier: number;
  exaggeration: number;
  showPerf: boolean;
  progressRef: React.MutableRefObject<LapProgress>;
  carPoseRef: React.MutableRefObject<{ position: THREE.Vector3; direction: THREE.Vector3 }>;
  onHoverIndex: (index: number | null) => void;
  onUserTakeover: () => void;
}

export function Scene({
  assets,
  trackDef,
  result,
  ghostResult,
  colorMode,
  viewpoint,
  orbiting,
  reducedMotion,
  playing,
  speedMultiplier,
  exaggeration,
  showPerf,
  progressRef,
  carPoseRef,
  onHoverIndex,
  onUserTakeover,
}: SceneProps) {
  const tokens = useThemeTokens();

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
        position: [center[0], extent * 0.5, center[2] + extent * 0.6],
        far: extent * 12,
        near: 1,
      }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        // without these the standard materials render flat and washed out
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }}
    >
      <color attach="background" args={[tokens.sceneBg]} />
      {/* fog pushed well out: at extent*1.2 it swallowed the track colours the moment the camera
          pulled back. Depth cueing comes from the terrain dots instead. */}
      <fog attach="fog" args={[tokens.sceneFog, extent * 3, extent * 8]} />

      <hemisphereLight
        args={[tokens.lightHemiSky, tokens.lightHemiGround, tokens.lightHemi]}
      />
      <directionalLight
        position={[center[0] + 600, 900, center[2] - 400]}
        intensity={tokens.lightKey}
      />
      {/* rim fill from the opposite side so the car and the kerbs keep an edge against the
          background rather than going flat where the key light does not reach */}
      <directionalLight
        position={[center[0] - 500, 300, center[2] + 600]}
        intensity={tokens.lightKey * 0.35}
        color={tokens.lightHemiSky}
      />

      {/* the terrain dot field is the only ground reference. A drei <Grid> used to sit under it
          and read as a second, competing square plane, which is what made the overview shot look
          like a circuit floating on graph paper. */}
      <TerrainGrid terrain={assets.terrain} exaggeration={exaggeration} />

      {/* the outline loads from JSON well before the GLB, so it stands in as the suspense
          fallback: the circuit draws itself progressively instead of popping in whole */}
      <group scale={[1, exaggeration, 1]}>
        <TrackOutline trackLines={assets.trackLines} />
        <Suspense fallback={null}>
          <TrackMesh url={assets.glbUrl} />
        </Suspense>
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
      {/* drei <Html> labels are real DOM, so they draw over the hero overlay: suppressed
          while the landing is up rather than fighting it with z-index */}
      {!orbiting && (
        <CornerLabels line={assets.line} corners={trackDef.corners} exaggeration={exaggeration} />
      )}

      <CameraRig
        viewpoint={viewpoint}
        orbiting={orbiting}
        reducedMotion={reducedMotion}
        center={center}
        extent={extent}
        carPoseRef={carPoseRef}
        onUserTakeover={onUserTakeover}
      />
      {showPerf && <Perf position="top-right" />}
    </Canvas>
  );
}
