// the control surface. Collapsed it is a 56px rail of live numbers with no controls at all;
// expanded it is five labelled groups. Replaces the old single 250px box that carried eight
// ungrouped rows of buttons and never got out of the way of the circuit.

import { Button, ButtonGroup, IconButton, Panel, Section, Select, Slider, Stat } from "./primitives";
import { formatLapTime } from "./TopBar";
import type { Expandable } from "./useExpandable";
import type { ColorMode } from "../render/RacingLine";
import type { Viewpoint } from "../render/viewpoints";

export interface HoverInfo {
  sM: number;
  vMps: number;
  axMps2: number;
  ayMps2: number;
}

interface SidePanelProps {
  panel: Expandable;
  /** below 760px the rail cannot share the width with a usable viewport, so it slides in over it */
  narrow: boolean;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  mu: number;
  onMuChange: (mu: number) => void;
  lapTimeS: number;
  ghostLapTimeS: number | null;
  solveMs: number;
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
  viewpoints: Viewpoint[];
  viewpointId: string;
  onViewpointChange: (id: string) => void;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  speedMultiplier: number;
  onSpeedMultiplierChange: (mult: number) => void;
  ghostEnabled: boolean;
  onGhostEnabledChange: (enabled: boolean) => void;
  exaggeration: number;
  onExaggerationChange: (factor: number) => void;
  showPerf: boolean;
  onShowPerfChange: (show: boolean) => void;
  hoverInfo: HoverInfo | null;
}

const PRIMARY_VIEWS = ["overview", "top", "start", "follow", "chase"];

export function SidePanel(props: SidePanelProps) {
  const { panel, narrow, drawerOpen } = props;
  // in the drawer there is no room for a peek state: it is either open in full or not there
  const expanded = narrow ? true : panel.expanded;

  const corners = props.viewpoints.filter((v) => v.id.startsWith("corner:"));
  const primaries = PRIMARY_VIEWS.map((id) => props.viewpoints.find((v) => v.id === id)).filter(
    (v): v is Viewpoint => !!v,
  );
  const activeCorner = props.viewpointId.startsWith("corner:") ? props.viewpointId : "";

  const ghostDelta =
    props.ghostLapTimeS === null ? null : props.lapTimeS - props.ghostLapTimeS;

  const narrowStyle: React.CSSProperties = {
    position: "fixed",
    top: 48,
    left: 0,
    bottom: 0,
    zIndex: 25,
    width: "min(300px, 86vw)",
    transform: drawerOpen ? "translateX(0)" : "translateX(-101%)",
    transition: "transform var(--t-base) var(--ease)",
    boxShadow: drawerOpen ? "0 0 0 100vmax rgba(0,0,0,0.45)" : "none",
  };

  return (
    <aside
      aria-label="Controls"
      aria-hidden={narrow && !drawerOpen}
      {...(narrow ? {} : panel.handlers)}
      style={{
        gridArea: "side",
        width: expanded ? 280 : 56,
        transition: "width var(--t-base) var(--ease)",
        background: "var(--panel)",
        borderRight: "1px solid var(--line)",
        overflowX: "hidden",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        minHeight: 0, // let the grid row size the rail, not the rail's content
        ...(narrow ? narrowStyle : null),
      }}
    >
      {narrow && (
        <div style={{ padding: "var(--s3) var(--s3) 0", display: "flex", justifyContent: "flex-end" }}>
          <Button onClick={props.onCloseDrawer}>close</Button>
        </div>
      )}
      {expanded ? (
        <>
          <Section
            label="Solver"
            action={
              narrow ? undefined : (
                <IconButton
                  label={panel.pinned ? "Unpin controls" : "Keep controls open"}
                  active={panel.pinned}
                  onClick={panel.togglePin}
                >
                  {panel.pinned ? "◉" : "○"}
                </IconButton>
              )
            }
          >
            <Slider
              label="grip μ"
              value={props.mu}
              min={0.6}
              max={1.4}
              step={0.01}
              onChange={props.onMuChange}
              format={(v) => v.toFixed(2)}
              onPointerDown={() => panel.setHold(true)}
              onPointerUp={() => panel.setHold(false)}
            />
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
              re-solved in <span className="tnum">{props.solveMs.toFixed(1)} ms</span>
            </div>
          </Section>

          <Section label="Result">
            <Stat label="lap time" value={formatLapTime(props.lapTimeS)} size="lg" />
            {ghostDelta !== null && (
              <Stat
                label="vs ghost μ1.20"
                value={formatLapTime(props.ghostLapTimeS as number)}
                delta={`${ghostDelta <= 0 ? "−" : "+"}${Math.abs(ghostDelta).toFixed(2)} s`}
                deltaTone={ghostDelta <= 0 ? "pos" : "neg"}
                size="sm"
              />
            )}
            {props.hoverInfo && (
              <div
                style={{
                  paddingTop: "var(--s2)",
                  borderTop: "1px solid var(--line)",
                  fontSize: 11,
                  color: "var(--text-muted)",
                  lineHeight: 1.7,
                }}
              >
                <div>
                  at <span className="tnum">{props.hoverInfo.sM.toFixed(0)} m</span> ·{" "}
                  <span className="tnum">{(props.hoverInfo.vMps * 3.6).toFixed(0)} km/h</span>
                </div>
                <div>
                  ax <span className="tnum">{props.hoverInfo.axMps2.toFixed(1)}</span> · ay{" "}
                  <span className="tnum">{props.hoverInfo.ayMps2.toFixed(1)}</span> m/s²
                </div>
              </div>
            )}
          </Section>

          <Section label="Camera">
            <ButtonGroup label="Camera viewpoint">
              {primaries.map((v) => (
                <Button
                  key={v.id}
                  active={props.viewpointId === v.id}
                  onClick={() => props.onViewpointChange(v.id)}
                >
                  {v.label}
                </Button>
              ))}
            </ButtonGroup>
            {corners.length > 0 && (
              <Select
                label="Corner"
                value={activeCorner}
                onChange={(id) => id && props.onViewpointChange(id)}
                options={[
                  { value: "", label: "jump to a corner…" },
                  ...corners.map((c) => ({ value: c.id, label: c.label })),
                ]}
              />
            )}
          </Section>

          <Section label="Playback">
            <Button
              variant="primary"
              size="md"
              onClick={() => props.onPlayingChange(!props.playing)}
              style={{ width: "100%" }}
            >
              {props.playing ? "❙❙  Pause" : "▶  Play"}
            </Button>
            <ButtonGroup label="Playback speed">
              {[0.5, 1, 5, 10].map((mult) => (
                <Button
                  key={mult}
                  active={props.speedMultiplier === mult}
                  onClick={() => props.onSpeedMultiplierChange(mult)}
                >
                  {mult}x
                </Button>
              ))}
            </ButtonGroup>
            <Button
              active={props.ghostEnabled}
              onClick={() => props.onGhostEnabledChange(!props.ghostEnabled)}
            >
              ghost car at μ1.20
            </Button>
          </Section>

          <Section label="Display">
            <ButtonGroup label="Line colouring">
              {(["phase", "speed"] as const).map((mode) => (
                <Button
                  key={mode}
                  active={props.colorMode === mode}
                  onClick={() => props.onColorModeChange(mode)}
                >
                  {mode === "phase" ? "phase" : "speed"}
                </Button>
              ))}
            </ButtonGroup>
            <ButtonGroup label="Elevation exaggeration">
              {[1, 3].map((factor) => (
                <Button
                  key={factor}
                  active={props.exaggeration === factor}
                  onClick={() => props.onExaggerationChange(factor)}
                >
                  elevation {factor}x
                </Button>
              ))}
            </ButtonGroup>
            <Button active={props.showPerf} onClick={() => props.onShowPerfChange(!props.showPerf)}>
              render stats
            </Button>
          </Section>
        </>
      ) : (
        <CollapsedRail
          mu={props.mu}
          lapTimeS={props.lapTimeS}
          playing={props.playing}
          onPlayingChange={props.onPlayingChange}
        />
      )}
    </aside>
  );
}

/** the resting state: glanceable numbers, one control, no labels competing with the circuit. */
function CollapsedRail({
  mu,
  lapTimeS,
  playing,
  onPlayingChange,
}: {
  mu: number;
  lapTimeS: number;
  playing: boolean;
  onPlayingChange: (p: boolean) => void;
}) {
  const cell: React.CSSProperties = {
    padding: "var(--s3) 0",
    textAlign: "center",
    borderBottom: "1px solid var(--line)",
  };
  const cap: React.CSSProperties = {
    fontSize: 9,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--text-dim)",
  };
  // 56px will not hold "2:28.416" at a readable size, so the rail drops the milliseconds; the
  // full-precision number is always in the top bar anyway
  const minutes = Math.floor(lapTimeS / 60);
  const seconds = lapTimeS - minutes * 60;
  const shortLap = `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
  return (
    <div>
      <div style={cell}>
        {/* no uppercase transform here: it turns the mu into a capital Mu, which reads as "M" */}
        <div style={{ ...cap, textTransform: "none" }}>grip μ</div>
        <div className="tnum" style={{ fontSize: 15, color: "var(--accent)", fontWeight: 600 }}>
          {mu.toFixed(2)}
        </div>
      </div>
      <div style={cell}>
        <div style={cap}>lap</div>
        <div className="tnum" style={{ fontSize: 12, color: "var(--text)" }}>
          {shortLap}
        </div>
      </div>
      <div style={{ ...cell, borderBottom: "none" }}>
        <IconButton
          label={playing ? "Pause" : "Play"}
          onClick={() => onPlayingChange(!playing)}
          active={playing}
        >
          {playing ? "❙❙" : "▶"}
        </IconButton>
      </div>
    </div>
  );
}

/** shown in the viewport corner: which viewpoint is active, and a hint that [ ] cycle them. */
export function ViewpointPill({
  viewpoint,
  onPrev,
  onNext,
}: {
  viewpoint: Viewpoint;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <Panel
      style={{
        position: "absolute",
        top: "var(--s3)",
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: "var(--s2)",
        padding: "3px 4px 3px 6px",
      }}
    >
      <IconButton label="Previous viewpoint" onClick={onPrev}>
        ‹
      </IconButton>
      <span
        style={{
          minWidth: 110,
          textAlign: "center",
          fontSize: 11,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        {viewpoint.label}
      </span>
      <IconButton label="Next viewpoint" onClick={onNext}>
        ›
      </IconButton>
    </Panel>
  );
}
