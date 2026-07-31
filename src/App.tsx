// app wiring: circuit selection, asset loading, the solver, and shared state between the
// HUD and the scene. The solver recomputes synchronously on every slider change -- it's
// low-single-digit milliseconds for a ~7000-point circuit (measured and shown in the HUD),
// so no debouncing, no worker, no async plumbing.

import { useEffect, useMemo, useRef, useState } from "react";
import type { CircuitAssets } from "./assets";
import { loadCircuitAssets } from "./assets";
import type { ColorMode } from "./render/RacingLine";
import { Scene } from "./render/Scene";
import { VelocitySolver } from "./solver/velocity";
import { TRACKS } from "./tracks";
import { Controls } from "./ui/Controls";
import { ElevationStrip } from "./ui/ElevationStrip";
import { Landing } from "./ui/Landing";

export default function App() {
  const [circuitId, setCircuitId] = useState("spa");
  const [assets, setAssets] = useState<CircuitAssets | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mu, setMu] = useState(1.2);
  const [colorMode, setColorMode] = useState<ColorMode>("phase");
  const [playing, setPlaying] = useState(true);
  const [speedMultiplier, setSpeedMultiplier] = useState(5);
  const [exaggeration, setExaggeration] = useState(1);
  const [showPerf, setShowPerf] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [solveMs, setSolveMs] = useState(0);
  const [showLanding, setShowLanding] = useState(true);

  const progressRef = useRef({ sM: 0, vMps: 0 });

  useEffect(() => {
    let cancelled = false;
    setAssets(null);
    setLoadError(null);
    loadCircuitAssets(circuitId)
      .then((loaded) => {
        if (!cancelled) setAssets(loaded);
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [circuitId]);

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

  useEffect(() => setSolveMs(measuredMs), [measuredMs]);

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
  if (!assets || !result) {
    return <div style={{ padding: 40 }}>loading {trackDef.displayName}…</div>;
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <Scene
        assets={assets}
        trackDef={trackDef}
        result={result}
        colorMode={colorMode}
        playing={playing}
        speedMultiplier={speedMultiplier}
        exaggeration={exaggeration}
        showPerf={showPerf}
        progressRef={progressRef}
        onHoverIndex={setHoverIndex}
      />
      <Controls
        tracks={TRACKS}
        circuitId={circuitId}
        onCircuitChange={setCircuitId}
        mu={mu}
        onMuChange={setMu}
        lapTimeS={result.lapTimeS}
        solveMs={solveMs}
        colorMode={colorMode}
        onColorModeChange={setColorMode}
        playing={playing}
        onPlayingChange={setPlaying}
        speedMultiplier={speedMultiplier}
        onSpeedMultiplierChange={setSpeedMultiplier}
        exaggeration={exaggeration}
        onExaggerationChange={setExaggeration}
        showPerf={showPerf}
        onShowPerfChange={setShowPerf}
        hoverInfo={hoverInfo}
      />
      <ElevationStrip line={assets.line} progressRef={progressRef} />
      {showLanding && <Landing onEnter={() => setShowLanding(false)} />}
    </div>
  );
}
