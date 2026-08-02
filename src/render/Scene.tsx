// the r3f scene: terrain, track mesh + outline + kerbs, racing line, braking markers, cars,
// labels, camera rig. Every colour and light level comes from the theme, so the toggle changes
// the whole composition rather than just the panels. Elevation exaggeration is applied as a Y
// scale on the track group; car markers and labels compensate internally.

import { Environment, Lightformer } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import { Perf } from "r3f-perf";
import * as THREE from "three";
import type { CircuitAssets } from "../assets";
import type { VelocityProfileResult } from "../solver/velocity";
import { useTheme, useThemeTokens } from "../ui/theme";
import { BrakingMarkers } from "./BrakingMarkers";
import { CameraRig } from "./CameraRig";
import { CarMarker, type LapProgress } from "./CarMarker";
import { CornerLabels } from "./CornerLabels";
import { Kerbs } from "./Kerbs";
import { Landmarks } from "./Landmarks";
import { RacingLine, type ColorMode } from "./RacingLine";
import { SkyDome } from "./SkyDome";
import { TerrainMesh } from "./TerrainMesh";
import { TrackMesh } from "./TrackMesh";
import { TrackOutline } from "./TrackOutline";
import type { Viewpoint } from "./viewpoints";

interface SceneProps {
  assets: CircuitAssets;
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
  const { theme } = useTheme();

  // one sun vector drives the sky, the image-based lighting and the key light, so the shading
  // and the sky agree instead of being tuned against each other. Low and raking in the dark
  // theme, high and near-overhead in the light one.
  const sun = useMemo<[number, number, number]>(
    () => (theme === "dark" ? [0.6, 0.12, -0.35] : [0.35, 0.85, -0.28]),
    [theme],
  );

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
      {/* a floor behind the dome. If SkyDome ever fails to compile or is suspended, this is
          what shows, and it is the horizon rather than the browser's default white. */}
      <color attach="background" args={[tokens.sceneBg]} />
      <SkyDome sun={sun} extent={extent} reducedMotion={reducedMotion} />

      {/* fogExp2, not linear. Linear fog has a start distance, and the terrain's far edge kept
          finding its way inside it; exponential-squared has no near plane and saturates
          smoothly, which is what reaching to infinity actually looks like. Density is derived
          from the circuit's own extent so Spa (2049 m) and Monza (2174 m) haze identically
          rather than one of them being tuned and the other inheriting it.

          The colour is tokens.sceneFog, which is also the sky dome's horizon band and also what
          the terrain occluder converges to. One value, three consumers, no way to disagree --
          the previous comment here claimed the fog tracked the sky's horizon, but the token it
          used was near-black while the sky was near-white. */}
      <fogExp2 attach="fog" args={[tokens.sceneFog, tokens.fogDensityK / extent]} />

      {/* renders once (frames={1}) into a 128px cube, so it costs about a millisecond at mount
          and nothing per frame. This is what makes the car's paint read as paint: three area
          lights standing in for sky, ground bounce and the sun. */}
      <Environment frames={1} resolution={128}>
        <Lightformer form="rect" intensity={theme === "dark" ? 0.6 : 1.4} scale={[100, 100, 1]}
          position={[0, 60, 0]} rotation={[-Math.PI / 2, 0, 0]} color={tokens.lightHemiSky} />
        <Lightformer form="rect" intensity={0.35} scale={[100, 100, 1]}
          position={[0, -40, 0]} rotation={[Math.PI / 2, 0, 0]} color={tokens.lightHemiGround} />
        <Lightformer form="circle" intensity={theme === "dark" ? 2.0 : 3.2} scale={[24, 24, 1]}
          position={[sun[0] * 0.1, sun[1] * 0.1, sun[2] * 0.1]} target={[0, 0, 0]} />
      </Environment>

      <hemisphereLight
        args={[tokens.lightHemiSky, tokens.lightHemiGround, tokens.lightHemi]}
      />
      <directionalLight
        position={[center[0] + sun[0] * 900, sun[1] * 900, center[2] + sun[2] * 900]}
        intensity={tokens.lightKey}
      />
      {/* rim fill from the opposite side so the car and the kerbs keep an edge against the
          background rather than going flat where the key light does not reach */}
      <directionalLight
        position={[center[0] - 500, 300, center[2] + 600]}
        intensity={tokens.lightKey * 0.35}
        color={tokens.lightHemiSky}
      />

      {/* the ground. A displaced heightfield rather than the dot field it replaces: the dots
          faded out below 60 m of camera altitude, so from the chase shot there was no ground at
          all. Same terrain.json, one draw call, visible at every altitude. */}
      <TerrainMesh
        terrain={assets.terrain}
        exaggeration={exaggeration}
        reducedMotion={reducedMotion}
      />

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

      {/* trackside content, in its own group: it carries the same exaggeration scale but must
          not inherit the track group's ordering, since the fence and boards are alpha-tested */}
      <Landmarks assets={assets} exaggeration={exaggeration} />

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
        <CornerLabels line={assets.line} corners={assets.landmarks.corners} exaggeration={exaggeration} />
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
