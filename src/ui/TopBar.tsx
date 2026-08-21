// the one piece of chrome that never collapses: identity, which circuit, the headline number,
// and the two global toggles. The lap time lives here rather than in the side rail because it is
// the answer the whole tool exists to produce, and it has to stay readable when everything else
// has receded.

import { IconButton, Select } from "./primitives";
import { useTheme } from "./theme";
import type { TrackDefinition } from "../tracks";

interface TopBarProps {
  tracks: TrackDefinition[];
  circuitId: string;
  onCircuitChange: (id: string) => void;
  lapTimeS: number;
  onHelp: () => void;
  helpOpen: boolean;
  /** on narrow screens the rail becomes a drawer and needs a trigger up here */
  narrow: boolean;
  onToggleControls: () => void;
  controlsOpen: boolean;
}

export function formatLapTime(lapTimeS: number): string {
  const minutes = Math.floor(lapTimeS / 60);
  const seconds = lapTimeS - minutes * 60;
  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

/** the title block's height. The rail and the dock hang off it, and App sizes the grid row from
 *  it, so it is one number rather than three that drift apart. */
export const TOPBAR_H = 60;

export function TopBar({
  tracks,
  circuitId,
  onCircuitChange,
  lapTimeS,
  onHelp,
  helpOpen,
  narrow,
  onToggleControls,
  controlsOpen,
}: TopBarProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header
      style={{
        gridArea: "top",
        display: "flex",
        alignItems: "center",
        gap: "var(--s4)",
        padding: "0 var(--s3)",
        background: "var(--panel)",
        borderBottom: "1px solid var(--line)",
        minWidth: 0,
      }}
    >
      {narrow && (
        <IconButton
          label={controlsOpen ? "Close controls" : "Open controls"}
          active={controlsOpen}
          onClick={onToggleControls}
        >
          ☰
        </IconButton>
      )}

      <h1
        style={{
          margin: 0,
          display: "flex",
          alignItems: "baseline",
          gap: 6,
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: "0.02em",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ color: "var(--accent)" }}>◆</span>
        <span style={{ color: "var(--text)" }}>track-side</span>
      </h1>

      <div style={{ minWidth: 0, overflow: "hidden" }}>
        <Select
          label="Circuit"
          hideLabel
          value={circuitId}
          onChange={onCircuitChange}
          options={tracks.map((t) => ({ value: t.id, label: t.displayName }))}
        />
      </div>

      <div style={{ flex: 1 }} />

      {/* the title block's headline. It sets at display scale because it is the answer the whole
          tool exists to produce, and it carries its own provenance because PRODUCT.md records
          that absolute lap times here are modelled from an estimated GT3 g-g-v, not measured.
          A hero number without that line would be the one claim on screen that is not true.

          polite, not assertive: a grip change should be announced when the reader is idle, not
          interrupt whatever it was saying */}
      <div
        style={{ display: narrow ? "none" : "flex", alignItems: "baseline", gap: "var(--s3)" }}
        aria-live="polite"
      >
        <span
          style={{
            fontSize: 12,
            letterSpacing: "0.09em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          Lap
        </span>
        <span
          className="tnum"
          style={{
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1,
            color: "var(--text)",
          }}
        >
          {formatLapTime(lapTimeS)}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-dim)", whiteSpace: "nowrap" }}>
          GT3 · modelled
        </span>
      </div>

      <div style={{ display: "flex", gap: "var(--s1)" }}>
        <IconButton
          label={theme === "dark" ? "Read the top sheet" : "Read under the work lamp"}
          onClick={toggleTheme}
        >
          {theme === "dark" ? "☀" : "☾"}
        </IconButton>
        <IconButton label="Keyboard and mouse guide" onClick={onHelp} active={helpOpen}>
          ?
        </IconButton>
      </div>
    </header>
  );
}
