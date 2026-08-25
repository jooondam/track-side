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
import { CircuitLoadError, loadCircuitAssets } from "./assets";
import type { LapProgress } from "./render/CarMarker";
import type { ColorMode } from "./render/RacingLine";
import { Scene } from "./render/Scene";
import { buildLapTimeTable } from "./solver/lapTime";
import { VelocitySolver } from "./solver/velocity";
import { CAMERA_FOV_DEG, buildViewpoints } from "./render/viewpoints";
import { TRACKS } from "./tracks";
import type { Corner } from "./assets";
import { ColorLegend } from "./ui/ColorLegend";
import { HelpOverlay } from "./ui/HelpOverlay";
import { Landing } from "./ui/Landing";
import type { PlateRect } from "./ui/Landing";
import { buildCornerRows } from "./ui/cornerRows";
import { AppState } from "./ui/AppState";
import { SceneBoundary } from "./ui/SceneBoundary";
import { RAIL_COLLAPSED_W, RAIL_EXPANDED_W, SidePanel, VIEWPOINT_PILL_BAND, ViewpointPill } from "./ui/SidePanel";
import { DOCK_STRIP_H, TelemetryDock, dockBodyHeight } from "./ui/TelemetryDock";
import { TOPBAR_H, TopBar } from "./ui/TopBar";
import { ThemeProvider, useIsNarrow, usePrefersReducedMotion, useTheme, useViewportSize } from "./ui/theme";
import { readUrlState, writeUrlState } from "./ui/urlState";
import { useExpandable } from "./ui/useExpandable";

const GHOST_MU = 1.2;
/** the grip the landing's margin column compares against. Low enough that the difference is
 *  worth printing, inside the slider's own range so it is a solve the reader can reproduce. */
const COVER_MU = 0.95;

/** whether this browser can give us a 3D context at all. Cheap, and done once: without it a
 *  machine with hardware acceleration switched off just renders a blank rectangle. */
function hasWebgl(): boolean {
  if (typeof document === "undefined") return true;
  try {
    const probe = document.createElement("canvas");
    return Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
  } catch {
    return false;
  }
}

// the state the query string carries, and the values it omits because they are the defaults
const URL_DEFAULTS = { circuit: "spa", view: "overview", mu: 1.2, color: "phase" };

export default function App() {
  return (
    <ThemeProvider>
      <Viewer />
    </ThemeProvider>
  );
}

function Viewer() {
  // read once, at mount: after this the URL is an output of the state, not an input to it
  const initial = useMemo(() => readUrlState(URL_DEFAULTS), []);

  const [circuitId, setCircuitId] = useState(initial.circuit);
  const [assets, setAssets] = useState<CircuitAssets | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  // bumped by Retry. Without it the retry set circuitId to the value it already had, React bailed
  // out of the render, and the load effect never re-ran: the button was inert from the day it
  // shipped.
  const [retryNonce, setRetryNonce] = useState(0);
  const webglOk = useMemo(hasWebgl, []);

  const [mu, setMu] = useState(initial.mu);
  const [colorMode, setColorMode] = useState<ColorMode>(initial.color as ColorMode);
  const [viewpointId, setViewpointId] = useState(initial.view);
  const [playing, setPlaying] = useState(initial.playing);
  const [speedMultiplier, setSpeedMultiplier] = useState(5);
  const [ghostEnabled, setGhostEnabled] = useState(initial.ghost);
  const [exaggeration, setExaggeration] = useState(1);
  const [showPerf, setShowPerf] = useState(false);
  const [showFurniture, setShowFurniture] = useState(initial.furniture);
  // null = follow the OS. An explicit choice wins, because prefers-reduced-motion was silently
  // switching the whole scene's animation off with nothing in the UI to say so or undo it.
  const [motionOverride, setMotionOverride] = useState<boolean | null>(initial.motion);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [solveMs, setSolveMs] = useState(0);
  const [showLanding, setShowLanding] = useState(!initial.enter);
  const [plateRect, setPlateRect] = useState<PlateRect | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);

  const { theme } = useTheme();

  const prefersReducedMotion = usePrefersReducedMotion();
  const reducedMotion = motionOverride === null ? prefersReducedMotion : !motionOverride;
  const narrow = useIsNarrow();
  const viewport = useViewportSize();
  const sidePanel = useExpandable("side");
  const dock = useExpandable("dock");

  const progressRef = useRef<LapProgress>({ sM: 0, vMps: 0, tS: 0, lapTimeS: 1, lapTS: 0, scrub: null });
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
        p.scrub = { s: 0 };
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [circuitId, retryNonce]);

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

  // scripts/shots.mjs polls this before capturing. It means "the geometry is in and the first
  // solve is done", not "the GPU has drawn it": the GLB arrives through Suspense and the terrain
  // shaders compile on first draw, so the script still waits a fixed number of frames after this
  // flips. Set from an effect rather than during render so it cannot lie about a committed tree.
  useEffect(() => {
    // written both ways: switching circuits clears assets, and a flag that only ever went true
    // would let the script photograph the previous circuit's frame
    (window as unknown as { __trackSideReady?: boolean }).__trackSideReady = Boolean(
      assets && result,
    );
  }, [assets, result]);

  // the address bar tracks the state, so any view can be linked or photographed
  useEffect(() => {
    writeUrlState(
      {
        circuit: circuitId,
        view: viewpointId,
        mu,
        color: colorMode,
        theme,
        enter: !showLanding,
        furniture: showFurniture,
        ghost: ghostEnabled,
        motion: motionOverride,
        playing,
      },
      URL_DEFAULTS,
    );
  }, [circuitId, viewpointId, mu, colorMode, theme, showLanding, showFurniture, ghostEnabled, motionOverride, playing]);

  const table = useMemo(
    () => (assets && result ? buildLapTimeTable(assets.line.sM, result.vMps, result.dlM) : null),
    [assets, result],
  );

  // the ghost's own cumulative-time table, which is what makes a delta possible at all: a delta
  // is the difference of two time-versus-distance curves, and until now only the car had one.
  const ghostTable = useMemo(
    () =>
      assets && ghostResult
        ? buildLapTimeTable(assets.line.sM, ghostResult.vMps, ghostResult.dlM)
        : null,
    [assets, ghostResult],
  );

  // the cover sheet's second solve, and only while the cover is up: it is what lets the margin
  // column say what grip is worth per corner instead of asserting it in a sentence. Its own
  // solver instance for the same reason the ghost has one.
  const coverResult = useMemo(() => {
    if (!assets || !showLanding) return null;
    const s = new VelocitySolver(assets.line.sM, assets.line.kappa1pm, assets.line.zM);
    return s.solve({ ...assets.vehicleBase, mu: COVER_MU });
  }, [assets, showLanding]);
  const coverRows = useMemo(() => {
    if (!assets || !result || !table || !coverResult) return [];
    const coverTable = buildLapTimeTable(assets.line.sM, coverResult.vMps, coverResult.dlM);
    return buildCornerRows(assets.line, result, table, coverTable, assets.landmarks.corners);
  }, [assets, result, table, coverResult]);

  // what the chrome covers, in canvas pixels. The rail is a drawer on narrow screens rather than
  // a persistent column, so it occludes nothing there; the dock's strip is always up.
  const railW = narrow || showLanding ? 0 : sidePanel.expanded ? RAIL_EXPANDED_W : RAIL_COLLAPSED_W;
  const dockH = showLanding
    ? 0
    : dock.expanded
      ? DOCK_STRIP_H + dockBodyHeight(ghostTable !== null)
      : DOCK_STRIP_H;
  // while the cover is up the camera composes for the diagram plate, which is a bounded figure
  // on the sheet rather than a backdrop behind it. The canvas is the whole window there, since
  // the top bar is not rendered until the cover is dismissed.
  const insets =
    showLanding && plateRect
      ? {
          left: Math.max(plateRect.left, 0),
          top: Math.max(plateRect.top, 0),
          right: Math.max(window.innerWidth - plateRect.right, 0),
          bottom: Math.max(window.innerHeight - plateRect.bottom, 0),
        }
      : { left: railW, bottom: dockH, top: VIEWPOINT_PILL_BAND, right: 0 };

  // the rectangle the chrome leaves uncovered, as an aspect. This is what the whole-circuit
  // viewpoints fit themselves to, so pinning a panel or resizing the window reframes the circuit
  // instead of cropping it. The canvas is the window minus the top bar, which is not rendered
  // while the cover is up.
  const canvasH = Math.max(viewport.height - (showLanding ? 0 : TOPBAR_H), 1);
  const visibleAspect =
    Math.max(viewport.width - insets.left - (insets.right ?? 0), 1) /
    Math.max(canvasH - (insets.top ?? 0) - insets.bottom, 1);

  const viewpoints = useMemo(
    () =>
      assets
        ? buildViewpoints(
            assets.line,
            assets.trackLines,
            assets.landmarks.corners,
            sceneCenter(assets),
            exaggeration,
            visibleAspect,
            CAMERA_FOV_DEG,
          )
        : [],
    [assets, exaggeration, visibleAspect],
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
    (corner: Corner) => setViewpointId(`corner:${corner.name}`),
    [],
  );

  const nudge = useCallback(
    (metres: number) => {
      if (!assets) return;
      const p = progressRef.current;
      const loop = assets.line.loopLengthM;
      const s = (((p.sM + metres) % loop) + loop) % loop;
      p.scrub = { s };
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

  if (!webglOk) {
    return <AppState kind="webgl" title="This browser cannot draw the circuit" />;
  }
  if (loadError) {
    const failure = loadError instanceof CircuitLoadError ? loadError.failure : undefined;
    return (
      <AppState
        kind="error"
        title={
          failure === "notfound"
            ? `No circuit called "${circuitId}"`
            : `Could not load ${trackDef.displayName}`
        }
        failure={failure}
        detail={loadError.message}
        onRetry={() => {
          setLoadError(null);
          setRetryNonce((n) => n + 1);
        }}
        retryLabel="Try again"
        tracks={TRACKS}
        circuitId={circuitId}
        onCircuitChange={(id) => {
          setLoadError(null);
          setCircuitId(id);
        }}
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
        gridTemplateRows: showLanding ? "1fr" : `${TOPBAR_H}px 1fr`,
        width: "100%",
        height: "100%",
        position: "relative",
        background: "var(--bg)",
        // the rail's current width, published so the dock can start where the rail ends and the
        // two animate as one gesture. The canvas still ignores it for sizing; the camera does
        // not, because a frame composed for pixels the rail is covering is not composed at all.
        ["--rail-w" as string]: `${railW}px`,
        ["--dock-h" as string]: `${dockH}px`,
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
        showFurniture={showFurniture}
        onShowFurnitureChange={setShowFurniture}
        motionOn={!reducedMotion}
        onMotionChange={(on) => setMotionOverride(on)}
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
        <SceneBoundary title={trackDef.displayName}>
        <Scene
          assets={assets}
          result={result}
          ghostResult={ghostResult}
          table={table}
          ghostTable={ghostTable}
          colorMode={colorMode}
          viewpoint={viewpoint}
          orbiting={showLanding}
          reducedMotion={reducedMotion}
          playing={playing}
          speedMultiplier={speedMultiplier}
          exaggeration={exaggeration}
          showPerf={showPerf}
          showFurniture={showFurniture}
          progressRef={progressRef}
          carPoseRef={carPoseRef}
          onHoverIndex={setHoverIndex}
          onUserTakeover={onUserTakeover}
          insets={insets}
        />
        </SceneBoundary>
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
            circuitId={circuitId}
            circuitName={trackDef.displayName}
            lapTimeS={result.lapTimeS}
            elevationRangeM={elevationRangeM}
            solveMs={solveMs}
            vehicle={assets.vehicleBase}
            mu={mu}
            compareMu={COVER_MU}
            rows={coverRows}
            onEnter={() => setShowLanding(false)}
            onEnterAtCorner={(corner) => {
              setViewpointId(`corner:${corner.name}`);
              setShowLanding(false);
            }}
            onPlateRect={setPlateRect}
          />
        )}
      </main>

      {!showLanding && (
      <TelemetryDock
        dock={dock}
        line={assets.line}
        result={result}
        table={table}
        ghostTable={ghostTable}
        mu={mu}
        corners={assets.landmarks.corners}
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
