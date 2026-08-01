// app wiring: circuit selection, asset loading, the solver, and the shared state between the HUD
// and the scene. The solver recomputes synchronously on every slider change: it's low-single-digit
// milliseconds for a ~7000-point circuit (measured and shown in the HUD), so no debouncing, no
// worker, no async plumbing.
//
// Layout is one CSS grid rather than four independently positioned corner boxes, which is what
// lets the rail and the dock collapse without anything else moving.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { CircuitAssets } from "./assets";
import { loadCircuitAssets } from "./assets";
import type { LapProgress } from "./render/CarMarker";
import type { ColorMode } from "./render/RacingLine";
import { Scene } from "./render/Scene";
import { buildLapTimeTable } from "./solver/lapTime";
import { VelocitySolver } from "./solver/velocity";
import { buildViewpoints } from "./render/viewpoints";
import { TRACKS } from "./tracks";
import type { CornerLabel } from "./tracks";
import { ColorLegend } from "./ui/ColorLegend";
import { HelpOverlay } from "./ui/HelpOverlay";
import { Landing } from "./ui/Landing";
import { AppState } from "./ui/AppState";
import { SidePanel, ViewpointPill } from "./ui/SidePanel";
import { TelemetryDock } from "./ui/TelemetryDock";
import { TopBar } from "./ui/TopBar";
import { ThemeProvider, useIsNarrow, useMediaQuery, usePrefersReducedMotion } from "./ui/theme";
import { useExpandable } from "./ui/useExpandable";

const GHOST_MU = 1.2;

export default function App() {
  return (
    <ThemeProvider>
      <Viewer />
    </ThemeProvider>
  );
}

function Viewer() {
  const [circuitId, setCircuitId] = useState("spa");
  const [assets, setAssets] = useState<CircuitAssets | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mu, setMu] = useState(1.2);
  const [colorMode, setColorMode] = useState<ColorMode>("phase");
  const [viewpointId, setViewpointId] = useState("overview");
  const [playing, setPlaying] = useState(true);
  const [speedMultiplier, setSpeedMultiplier] = useState(5);
  const [ghostEnabled, setGhostEnabled] = useState(false);
  const [exaggeration, setExaggeration] = useState(1);
  const [showPerf, setShowPerf] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [solveMs, setSolveMs] = useState(0);
  const [showLanding, setShowLanding] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);

  const reducedMotion = usePrefersReducedMotion();
  const narrow = useIsNarrow();
  const portrait = useMediaQuery("(orientation: portrait)");
  const sidePanel = useExpandable("side");
  const dock = useExpandable("dock");

  const progressRef = useRef<LapProgress>({ sM: 0, vMps: 0, tS: 0, lapTimeS: 1, scrub: null });
  const carPoseRef = useRef({
    position: new THREE.Vector3(),
    direction: new THREE.Vector3(1, 0, 0),
  });

  const trackDef = TRACKS.find((t) => t.id === circuitId) ?? TRACKS[0];

  useEffect(() => {
    let cancelled = false;
    setAssets(null);
    setLoadError(null);
    loadCircuitAssets(circuitId)
      .then((loaded) => {
        if (cancelled) return;
        setAssets(loaded);
        const p = progressRef.current;
        p.scrub = { id: (p.scrub?.id ?? 0) + 1, s: 0 };
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [circuitId]);

  const solver = useMemo(
    () => (assets ? new VelocitySolver(assets.line.sM, assets.line.kappa1pm, assets.line.zM) : null),
    [assets],
  );

  const { result, measuredMs } = useMemo(() => {
    if (!solver || !assets) return { result: null, measuredMs: 0 };
    const t0 = performance.now();
    const solved = solver.solve({ ...assets.vehicleBase, mu });
    return { result: solved, measuredMs: performance.now() - t0 };
  }, [solver, assets, mu]);

  // ghost profile at the fixed reference grip. Needs its own solver instance: the live solver's
  // result buffers are reused across solves, so sharing one would alias the ghost's arrays onto
  // the live car's.
  const ghostSolver = useMemo(
    () =>
      assets && ghostEnabled
        ? new VelocitySolver(assets.line.sM, assets.line.kappa1pm, assets.line.zM)
        : null,
    [assets, ghostEnabled],
  );
  const ghostResult = useMemo(() => {
    if (!ghostSolver || !assets) return null;
    return ghostSolver.solve({ ...assets.vehicleBase, mu: GHOST_MU });
  }, [ghostSolver, assets]);

  useEffect(() => setSolveMs(measuredMs), [measuredMs]);

  const table = useMemo(
    () => (assets && result ? buildLapTimeTable(assets.line.sM, result.vMps, result.dlM) : null),
    [assets, result],
  );

  const viewpoints = useMemo(
    () =>
      assets
        ? buildViewpoints(
            assets.line,
            trackDef.corners,
            sceneCenter(assets),
            sceneExtent(assets),
            exaggeration,
            portrait ? 1.7 : 1,
          )
        : [],
    [assets, trackDef, exaggeration, portrait],
  );
  const viewpoint =
    viewpoints.find((v) => v.id === viewpointId) ?? viewpoints[0] ?? FALLBACK_VIEWPOINT;

  const cycleViewpoint = useCallback(
    (step: number) => {
      if (viewpoints.length === 0) return;
      const i = viewpoints.findIndex((v) => v.id === viewpointId);
      const next = (i + step + viewpoints.length) % viewpoints.length;
      setViewpointId(viewpoints[next].id);
    },
    [viewpoints, viewpointId],
  );

  const selectCorner = useCallback(
    (corner: CornerLabel) => setViewpointId(`corner:${corner.name}`),
    [],
  );

  const nudge = useCallback(
    (metres: number) => {
      if (!assets) return;
      const p = progressRef.current;
      const loop = assets.line.loopLengthM;
      const s = (((p.sM + metres) % loop) + loop) % loop;
      p.scrub = { id: (p.scrub?.id ?? 0) + 1, s };
    },
    [assets],
  );

  // global keys. Every handler bails when focus is in a form control so the grip slider's arrow
  // keys stay the slider's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      ) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "?") {
        setHelpOpen((o) => !o);
      } else if (e.key === "[") {
        cycleViewpoint(-1);
      } else if (e.key === "]") {
        cycleViewpoint(1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setPlaying(false);
        nudge(e.shiftKey ? 250 : 25);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPlaying(false);
        nudge(e.shiftKey ? -250 : -25);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cycleViewpoint, nudge]);

  const pauseForScrub = useCallback(() => setPlaying(false), []);
  // grabbing the camera out of a follow shot should leave you in free look, not snap back
  const onUserTakeover = useCallback(() => {
    setViewpointId((id) => (id === "follow" || id === "chase" ? "overview" : id));
  }, []);

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
    return (
      <AppState
        kind="error"
        title="Could not load this circuit"
        detail={loadError}
        onRetry={() => setCircuitId((id) => id)}
        retryLabel="Try again"
      />
    );
  }
  if (!assets || !result || !table) {
    return <AppState kind="loading" title={trackDef.displayName} detail="loading circuit geometry" />;
  }

  const elevationRangeM = elevationRange(assets);

  return (
    <div
      style={{
        display: "grid",
        // while the hero is up the chrome is not rendered at all and the viewport takes the whole
        // frame. The Canvas is never unmounted across the transition, so entering is a camera
        // move rather than a reload.
        // one column, two rows: the viewport owns everything below the top bar at every width.
        // The rail and the dock are overlays on top of it rather than grid tracks beside it,
        // so opening either one no longer resizes the canvas. That resize was not just a
        // reflow: it reallocated the WebGL drawing buffer and reset the camera aspect on every
        // toggle, which is what made expanding a panel jolt rather than slide.
        gridTemplateAreas: showLanding ? `"view"` : `"top" "view"`,
        gridTemplateColumns: "1fr",
        gridTemplateRows: showLanding ? "1fr" : "48px 1fr",
        width: "100%",
        height: "100%",
        position: "relative",
        background: "var(--bg)",
        // the rail's current width, published so the dock can start where the rail ends and the
        // two animate as one gesture. The canvas ignores it entirely, which is the point.
        ["--rail-w" as string]: narrow || showLanding ? "0px" : sidePanel.expanded ? "280px" : "56px",
      }}
    >
      {!showLanding && (
        <a className="skip-link" href="#viewport">
          Skip to the circuit
        </a>
      )}

      {!showLanding && (
      <TopBar
        tracks={TRACKS}
        circuitId={circuitId}
        onCircuitChange={setCircuitId}
        lapTimeS={result.lapTimeS}
        onHelp={() => setHelpOpen((o) => !o)}
        helpOpen={helpOpen}
        narrow={narrow}
        controlsOpen={controlsOpen}
        onToggleControls={() => setControlsOpen((o) => !o)}
      />
      )}

      {!showLanding && (
      <SidePanel
        panel={sidePanel}
        narrow={narrow}
        drawerOpen={controlsOpen}
        onCloseDrawer={() => setControlsOpen(false)}
        mu={mu}
        onMuChange={setMu}
        lapTimeS={result.lapTimeS}
        ghostLapTimeS={ghostResult?.lapTimeS ?? null}
        solveMs={solveMs}
        colorMode={colorMode}
        onColorModeChange={setColorMode}
        viewpoints={viewpoints}
        viewpointId={viewpoint.id}
        onViewpointChange={setViewpointId}
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
      )}

      {/* minHeight/minWidth 0 are load-bearing: a grid item defaults to min-content sizing, and
          the r3f canvas reports its own height, so without these the 1fr row grew to the full
          viewport and pushed the telemetry dock off the bottom of the screen */}
      <main
        id="viewport"
        style={{ gridArea: "view", position: "relative", minWidth: 0, minHeight: 0, overflow: "hidden" }}
      >
        <Scene
          assets={assets}
          trackDef={trackDef}
          result={result}
          ghostResult={ghostResult}
          colorMode={colorMode}
          viewpoint={viewpoint}
          orbiting={showLanding}
          reducedMotion={reducedMotion}
          playing={playing}
          speedMultiplier={speedMultiplier}
          exaggeration={exaggeration}
          showPerf={showPerf}
          progressRef={progressRef}
          carPoseRef={carPoseRef}
          onHoverIndex={setHoverIndex}
          onUserTakeover={onUserTakeover}
        />
        {!showLanding && (
          <>
            <ViewpointPill
              viewpoint={viewpoint}
              onPrev={() => cycleViewpoint(-1)}
              onNext={() => cycleViewpoint(1)}
            />
            <ColorLegend colorMode={colorMode} result={result} />
          </>
        )}
        {showLanding && (
          <Landing
            circuitName={trackDef.displayName}
            lapTimeS={result.lapTimeS}
            cornerCount={trackDef.corners.length}
            elevationRangeM={elevationRangeM}
            onEnter={() => setShowLanding(false)}
          />
        )}
      </main>

      {!showLanding && (
      <TelemetryDock
        dock={dock}
        line={assets.line}
        result={result}
        table={table}
        corners={trackDef.corners}
        progressRef={progressRef}
        onHoverIndex={setHoverIndex}
        onScrubStart={pauseForScrub}
        onCornerSelect={selectCorner}
      />
      )}

      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

const FALLBACK_VIEWPOINT = {
  id: "overview",
  label: "Overview",
  kind: "static" as const,
};

function sceneCenter(assets: CircuitAssets): readonly [number, number, number] {
  const b = bounds(assets);
  return [(b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2] as const;
}

function sceneExtent(assets: CircuitAssets): number {
  const b = bounds(assets);
  return Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
}

function bounds(assets: CircuitAssets) {
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
  return { minX, maxX, minZ, maxZ };
}

function elevationRange(assets: CircuitAssets): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < assets.line.nPoints; i++) {
    const y = assets.line.positionYup[3 * i + 1];
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  return hi - lo;
}
