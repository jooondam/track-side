// the states that are not "everything worked": loading, failed, and no WebGL. Previously all
// three were either a bare string at padding: 40 or a blank canvas.
//
// The error copy names the thing that failed and offers the one action that might fix it, rather
// than printing an exception at the user. It also distinguishes an offline browser from a
// genuinely missing asset, because those need different things from the reader.

import { Button, Panel } from "./primitives";

interface AppStateProps {
  kind: "loading" | "error";
  title: string;
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function AppState({ kind, title, detail, onRetry, retryLabel }: AppStateProps) {
  const offline = kind === "error" && typeof navigator !== "undefined" && !navigator.onLine;

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
      role={kind === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      <Panel style={{ width: 400, maxWidth: "calc(100vw - 32px)", padding: "var(--s5)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--text-dim)",
          }}
        >
          <span style={{ color: "var(--accent)" }}>◆</span> track-side
        </div>

        <h1 style={{ margin: "var(--s3) 0 var(--s2)", fontSize: 18, fontWeight: 600 }}>{title}</h1>

        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: "var(--text-muted)" }}>
          {kind === "loading"
            ? (detail ?? "loading")
            : offline
              ? "Your browser is offline, so the circuit data could not be fetched. Reconnect and try again."
              : `The circuit data did not load. ${detail ?? ""}`}
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

        {onRetry && (
          <div style={{ marginTop: "var(--s4)" }}>
            <Button variant="primary" size="md" onClick={onRetry}>
              {retryLabel ?? "Retry"}
            </Button>
          </div>
        )}
      </Panel>
    </div>
  );
}
