// app wiring: circuit selection, asset loading, the solver, and shared state between the
// HUD and the scene. The solver recomputes synchronously on every slider change: it's
// low-single-digit milliseconds for a ~7000-point circuit (measured and shown in the HUD),
// so no debouncing, no worker, no async plumbing.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { CircuitAssets } from "./assets";
import { loadCircuitAssets } from "./assets";
import type { CameraMode } from "./render/CameraRig";
import type { LapProgress } from "./render/CarMarker";
import type { ColorMode } from "./render/RacingLine";
import { Scene } from "./render/Scene";
import { buildLapTimeTable } from "./solver/lapTime";
import { VelocitySolver } from "./solver/velocity";
import { TRACKS } from "./tracks";
import { ColorLegend } from "./ui/ColorLegend";
import { Controls } from "./ui/Controls";
import { ElevationStrip } from "./ui/ElevationStrip";
import { HelpOverlay } from "./ui/HelpOverlay";
import { Landing } from "./ui/Landing";
import { SpeedTrace } from "./ui/SpeedTrace";
import { Timeline } from "./ui/Timeline";

const GHOST_MU = 1.2;

export default function App() {
  const [circuitId, setCircuitId] = useState("spa");
  const [assets, setAssets] = useState<CircuitAssets | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mu, setMu] = useState(1.2);
  const [colorMode, setColorMode] = useState<ColorMode>("phase");
  const [cameraMode, setCameraMode] = useState<CameraMode>("free");
  const [playing, setPlaying] = useState(true);
  const [speedMultiplier, setSpeedMultiplier] = useState(5);
  const [ghostEnabled, setGhostEnabled] = useState(false);
  const [exaggeration, setExaggeration] = useState(1);
  const [showPerf, setShowPerf] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [solveMs, setSolveMs] = useState(0);
  const [showLanding, setShowLanding] = useState(true);

  const progressRef = useRef<LapProgress>({
    sM: 0,
    vMps: 0,
    tS: 0,
    lapTimeS: 1,
    scrub: null,
  });
  const carPoseRef = useRef({
    position: new THREE.Vector3(),
    direction: new THREE.Vector3(1, 0, 0),
  });

  useEffect(() => {
    let cancelled = false;
    setAssets(null);
    setLoadError(null);
    loadCircuitAssets(circuitId)
      .then((loaded) => {
        if (!cancelled) {
          setAssets(loaded);
          const p = progressRef.current;
          p.scrub = { id: (p.scrub?.id ?? 0) + 1, s: 0 };
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [circuitId]);

  // spacebar play/pause (input-focused events excluded)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const solver = useMemo(
    () => (assets ? new VelocitySolver(assets.line.sM, assets.line.kappa1pm) : null),
    [assets],
  );

  const { result, measuredMs } = useMemo(() => {
    if (!solver || !assets) return { result: null, measuredMs: 0 };
    const t0 = performance.now();
    const solved = solver.solve({ ...assets.vehicleBase, mu });
    return { result: solved, measuredMs: performance.now() - t0 };
  }, [solver, assets, mu]);

  // ghost profile at the fixed reference grip. Needs its own solver instance: the live
  // solver's result buffers are reused across solves, so sharing one instance would alias
  // the ghost's arrays onto the live car's.
  const ghostSolver = useMemo(
    () =>
      assets && ghostEnabled ? new VelocitySolver(assets.line.sM, assets.line.kappa1pm) : null,
    [assets, ghostEnabled],
  );
  const ghostResult = useMemo(() => {
    if (!ghostSolver || !assets) return null;
    return ghostSolver.solve({ ...assets.vehicleBase, mu: GHOST_MU });
  }, [ghostSolver, assets]);

  useEffect(() => setSolveMs(measuredMs), [measuredMs]);

  const table = useMemo(
    () => (assets && result ? buildLapTimeTable(assets.line.sM, result.vMps) : null),
    [assets, result],
  );

  const ghostLapTimeS = useMemo(() => {
    if (!ghostResult) return null;
    return ghostResult.lapTimeS;
  }, [ghostResult]);

  const pauseForScrub = useCallback(() => setPlaying(false), []);

  const trackDef = TRACKS.find((t) => t.id === circuitId) ?? TRACKS[0];

  const hoverInfo =
    hoverIndex !== null && result && assets
      ? {
          sM: assets.line.sM[hoverIndex],
          vMps: result.vMps[hoverIndex],
          axMps2: result.axMps2[hoverIndex],
          ayMps2: result.ayMps2[hoverIndex],
        }
      : null;

  if (loadError) {
    return <div style={{ padding: 40 }}>failed to load circuit assets: {loadError}</div>;
  }
  if (!assets || !result || !table) {
    return <div style={{ padding: 40 }}>loading {trackDef.displayName}…</div>;
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <Scene
        assets={assets}
        trackDef={trackDef}
        result={result}
        ghostResult={ghostResult}
        colorMode={colorMode}
        cameraMode={cameraMode}
        onCameraModeChange={setCameraMode}
        playing={playing}
        speedMultiplier={speedMultiplier}
        exaggeration={exaggeration}
        showPerf={showPerf}
        progressRef={progressRef}
        carPoseRef={carPoseRef}
        onHoverIndex={setHoverIndex}
      />
      <Controls
        tracks={TRACKS}
        circuitId={circuitId}
        onCircuitChange={setCircuitId}
        mu={mu}
        onMuChange={setMu}
        lapTimeS={result.lapTimeS}
        ghostLapTimeS={ghostLapTimeS}
        solveMs={solveMs}
        colorMode={colorMode}
        onColorModeChange={setColorMode}
        cameraMode={cameraMode}
        onCameraModeChange={setCameraMode}
        playing={playing}
        onPlayingChange={setPlaying}
        speedMultiplier={speedMultiplier}
        onSpeedMultiplierChange={setSpeedMultiplier}
        ghostEnabled={ghostEnabled}
        onGhostEnabledChange={setGhostEnabled}
        exaggeration={exaggeration}
        onExaggerationChange={setExaggeration}
        showPerf={showPerf}
        onShowPerfChange={setShowPerf}
        hoverInfo={hoverInfo}
      />

      <div
        style={{
          position: "absolute",
          bottom: 12,
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(10, 10, 15, 0.8)",
          border: "1px solid #22222e",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        <SpeedTrace
          line={assets.line}
          result={result}
          progressRef={progressRef}
          onHoverIndex={setHoverIndex}
          onScrubStart={pauseForScrub}
        />
        <ElevationStrip line={assets.line} progressRef={progressRef} onScrubStart={pauseForScrub} />
        <Timeline
          sM={assets.line.sM}
          table={table}
          progressRef={progressRef}
          onScrubStart={pauseForScrub}
        />
      </div>

      <ColorLegend colorMode={colorMode} result={result} />
      <HelpOverlay />
      {showLanding && <Landing onEnter={() => setShowLanding(false)} />}
    </div>
  );
}
