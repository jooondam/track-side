// the viewer's shareable state, carried in the query string.
//
// Two things this buys, and the second is why it exists at all:
//
//   1. a corner viewpoint at a given grip becomes a link. "Eau Rouge, mu 1.0, phase colours" is
//      ?circuit=spa&view=corner:Eau%20Rouge&mu=1&color=phase&enter=1 rather than six clicks.
//   2. it is the whole screenshot API. scripts/shots.mjs drives the app by URL, so capturing a
//      frame needs no test hook, no injected globals and no privileged build. Anything the
//      script can photograph is a state a user can reach and link to.
//
// History is replaced rather than pushed: dragging the grip slider writes here on every frame's
// worth of change, and pushing would bury the back button under a hundred entries.

import type { Corner } from "../assets";
import type { ThemeName } from "./theme";

export interface UrlState {
  circuit: string;
  view: string;
  mu: number;
  color: string;
  theme: ThemeName | null;
  /** skip the landing hero and go straight to the viewer */
  enter: boolean;
  /** trackside scenery. Off is a real request ("just show me the line"), and it is also how a
   *  screenshot isolates the road from the furniture standing beside it. */
  furniture: boolean;
  /** the reference-grip ghost car, and with it the delta trace and the delta column. */
  ghost: boolean;
  /**
   * scene animation. null follows the OS's prefers-reduced-motion, which is the default and the
   * accessible answer; true or false is an explicit override by the viewer.
   */
  motion: boolean | null;
  /** lap playback. Off makes a capture deterministic, which is what lets two frames be compared. */
  playing: boolean;
  /**
   * where in the lap to start, as `corner:<name>`. A seek, not a state: it seeds the lap clock
   * once on load and is never written back, the way `?t=` on a video link addresses a moment
   * without becoming part of the player's state.
   *
   * Both cars run off one clock, so this places the ghost too -- at wherever *it* has got to by
   * the time the car reaches that corner, which is the grip difference drawn as a gap rather than
   * quoted as a number. Without it every frozen frame is the start line, since that is where the
   * clock begins.
   */
  at: string | null;
}

/** parse whatever is in the address bar, tolerating anything malformed by falling back. */
type Defaults = Omit<
  UrlState,
  "theme" | "enter" | "furniture" | "ghost" | "motion" | "playing" | "at"
>;

export function readUrlState(defaults: Defaults): UrlState {
  const q = new URLSearchParams(window.location.search);
  const mu = Number(q.get("mu"));
  const theme = q.get("theme");
  return {
    circuit: q.get("circuit") ?? defaults.circuit,
    view: q.get("view") ?? defaults.view,
    // an out-of-range or unparseable mu falls back rather than handing NaN to the solver
    mu: Number.isFinite(mu) && mu > 0 ? mu : defaults.mu,
    color: q.get("color") ?? defaults.color,
    theme: theme === "light" || theme === "dark" ? theme : null,
    enter: q.get("enter") === "1",
    furniture: q.get("furniture") !== "0",
    ghost: q.get("ghost") === "1",
    motion: q.get("motion") === "1" ? true : q.get("motion") === "0" ? false : null,
    playing: q.get("play") !== "0",
    at: q.get("at"),
  };
}

/** write the current state back, omitting anything still at its default so links stay short. */
export function writeUrlState(state: Omit<UrlState, "at">, defaults: Defaults): void {
  const q = new URLSearchParams();
  if (state.circuit !== defaults.circuit) q.set("circuit", state.circuit);
  if (state.view !== defaults.view) q.set("view", state.view);
  if (state.mu !== defaults.mu) q.set("mu", String(Math.round(state.mu * 100) / 100));
  if (state.color !== defaults.color) q.set("color", state.color);
  if (state.theme) q.set("theme", state.theme);
  if (state.enter) q.set("enter", "1");
  if (!state.furniture) q.set("furniture", "0");
  if (state.ghost) q.set("ghost", "1");
  if (state.motion !== null) q.set("motion", state.motion ? "1" : "0");
  if (!state.playing) q.set("play", "0");
  // `at` is deliberately absent: it is consumed once on load, and echoing it back would leave a
  // link claiming a moment the car has since driven away from.

  const query = q.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
  if (next !== `${window.location.pathname}${window.location.search}`) {
    window.history.replaceState(null, "", next);
  }
}

/**
 * Arc length for an `?at=` seek, or 0 for the start line.
 *
 * Matched case-insensitively, because the name comes out of a URL a person typed or edited, and
 * `corner:eau rouge` meaning something different from `corner:Eau Rouge` would be a trap. An
 * unrecognised corner falls back to the start line rather than throwing: a mistyped link should
 * open the circuit, not an error card.
 *
 * Resolved against the corner's own `sM`, which is what cornerRows.ts reads it as, so a seek and
 * the corner report agree on where a corner is.
 */
export function seekArcLength(at: string | null, corners: readonly Corner[]): number {
  if (!at?.toLowerCase().startsWith("corner:")) return 0;
  const name = at.slice("corner:".length).trim().toLowerCase();
  return corners.find((c) => c.name.toLowerCase() === name)?.sM ?? 0;
}
