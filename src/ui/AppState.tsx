// the states that are not "everything worked": loading, failed, and no WebGL. Previously all
// three were either a bare string at padding: 40 or a blank canvas.
//
// The error copy names the thing that failed and offers the one action that might fix it, rather
// than printing an exception at the user. Which action that is depends on why it failed: a
// circuit that does not exist needs a different circuit, not a retry, so the picker ships on the
// card itself and a shared link with a stale ?circuit= stops being a dead end.
//
// The raw message is kept, because "it said something about a doctype" is the only useful thing a
// reader can relay to whoever wrote this. It is just not the headline.

import type { LoadFailure } from "../assets";
import type { TrackDefinition } from "../tracks";
import { Button, Select } from "./primitives";
import { Icon } from "./Icon";
import { TYPE } from "./theme";
import { MASTHEAD_TRACK } from "./Landing";

interface AppStateProps {
  kind: "loading" | "error" | "webgl";
  title: string;
  /** the raw failure text, shown under a disclosure rather than as the message */
  detail?: string;
  failure?: LoadFailure;
  /** overrides the copy derived from `failure`, for failures that are not a load at all */
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** offered on the error card so a bad ?circuit= always has a way out */
  tracks?: readonly TrackDefinition[];
  circuitId?: string;
  onCircuitChange?: (id: string) => void;
}

/** what actually went wrong, in the second person, plus what to do about it. */
function explain(failure: LoadFailure | undefined, offline: boolean): string {
  if (offline || failure === "offline") {
    return "Your browser is offline, so the circuit data could not be fetched. Reconnect and try again.";
  }
  switch (failure) {
    case "notfound":
      return "There is no circuit at that address. Pick one below, or check the link you followed.";
    case "malformed":
      return "The circuit data downloaded but could not be read. It may have been served only partly.";
    case "http":
      return "The server refused the circuit data. This is usually temporary, so try again.";
    case "network":
      return "The circuit data could not be reached. Check your connection, then try again.";
    default:
      return "The circuit data did not load.";
  }
}

export function AppState({
  kind,
  title,
  detail,
  failure,
  message,
  onRetry,
  retryLabel,
  tracks,
  circuitId,
  onCircuitChange,
}: AppStateProps) {
  const offline = kind === "error" && typeof navigator !== "undefined" && !navigator.onLine;
  // retrying a circuit that does not exist just fails again at the same address, so the card
  // leads with the picker instead and demotes the retry
  const retryIsUseless = failure === "notfound";
  const showPicker = kind === "error" && !!tracks && !!onCircuitChange && !!circuitId;
  const known = !!tracks?.some((t) => t.id === circuitId);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
      }}
      role={kind === "loading" ? "status" : "alert"}
      aria-live="polite"
    >
      {/* a sheet laid on the binder, not a card floating over the app. The world says the
          interface is ruled paper, and a 400px rounded panel with a border on four sides was the
          one surface still arguing with that. Same masthead, same double rule under it, same
          left-aligned column as the cover: a reader who has seen the front page has already been
          taught how to read this. */}
      <div
        style={{
          width: 560,
          maxWidth: "calc(100vw - 32px)",
          background: "var(--panel)",
          borderTop: "2px solid var(--line-strong)",
          borderBottom: "1px solid var(--line)",
          padding: "var(--s5) clamp(20px, 5vw, 40px) var(--s5)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: TYPE.size.label,
            letterSpacing: MASTHEAD_TRACK,
            textTransform: "uppercase",
            color: "var(--text-dim)",
          }}
        >
          <span style={{ color: "var(--accent)", display: "flex" }}>
            <Icon name="mark" size={10} />
          </span>
          track-side
        </div>
        <div style={{ height: 2, background: "var(--line-strong)", marginTop: "var(--s2)" }} />

        <h1 style={{ margin: "var(--s3) 0 var(--s2)", fontSize: TYPE.size.figure, fontWeight: TYPE.weight.bold }}>{title}</h1>

        <p style={{ margin: 0, fontSize: TYPE.size.label, lineHeight: 1.6, color: "var(--text-muted)" }}>
          {kind === "loading"
            ? (detail ?? "loading")
            : kind === "webgl"
              ? "This browser could not start WebGL, which the 3D view needs. It is usually hardware acceleration being switched off, or a very old browser."
              : (message ?? explain(failure, offline))}
        </p>

        {kind === "loading" && (
          <div
            style={{
              marginTop: "var(--s4)",
              height: 2,
              background: "var(--line)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: "35%",
                height: "100%",
                background: "var(--accent)",
                animation: "ts-slide 1.1s var(--ease) infinite",
              }}
            />
            <style>{"@keyframes ts-slide{from{transform:translateX(-100%)}to{transform:translateX(340%)}}"}</style>
          </div>
        )}

        {showPicker && (
          <div style={{ marginTop: "var(--s4)" }}>
            {/* when the id in the URL is not a circuit, a plain <select> falls back to showing
                the first option, which reads as "Spa is already selected" and hides the fact
                that a choice is still required. The placeholder says the quiet part. */}
            <Select
              label="Circuit"
              value={known ? circuitId : ""}
              options={[
                ...(known ? [] : [{ value: "", label: "Choose a circuit…" }]),
                ...tracks.map((t) => ({ value: t.id, label: t.displayName })),
              ]}
              onChange={(id) => id && onCircuitChange(id)}
            />
          </div>
        )}

        {(onRetry || detail) && (
          <div
            style={{
              marginTop: "var(--s4)",
              display: "flex",
              alignItems: "center",
              gap: "var(--s3)",
              flexWrap: "wrap",
            }}
          >
            {onRetry && (
              <Button
                variant={retryIsUseless ? "default" : "primary"}
                size="md"
                onClick={onRetry}
              >
                {retryLabel ?? "Retry"}
              </Button>
            )}
          </div>
        )}

        {detail && kind !== "loading" && (
          <details style={{ marginTop: "var(--s3)" }}>
            <summary
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--s2)",
                fontSize: TYPE.size.label,
                color: "var(--text-dim)",
                cursor: "pointer",
                letterSpacing: TYPE.track.label,
              }}
            >
              <span className="ts-marker" style={{ display: "flex" }}>
                <Icon name="next" size={12} />
              </span>
              What the browser reported
            </summary>
            <p
              style={{
                margin: "var(--s2) 0 0",
                fontFamily: "var(--font-mono)",
                fontSize: TYPE.size.label,
                lineHeight: 1.5,
                color: "var(--text-dim)",
                wordBreak: "break-word",
              }}
            >
              {detail}
            </p>
          </details>
        )}
      </div>
    </div>
  );
}
