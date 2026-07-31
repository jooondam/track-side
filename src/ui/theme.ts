// the single source of colour, spacing, type and motion for the whole app. Two themes, one
// token vocabulary. Nothing else in src/ may contain a hex literal: the DOM reads the tokens as
// CSS custom properties, while the canvas charts and the three.js scene read the same values as
// plain strings through useThemeTokens (neither can resolve var()).
//
// contrast: every text-on-surface pair below was measured against WCAG 2.2 1.4.3. The muted and
// dim greys are exactly as light/dark as they need to be to clear 4.5:1 on their own panel, which
// is why they look less subtle than the values they replaced.

import { createContext, createElement, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type ThemeName = "dark" | "light";

export interface ThemeTokens {
  // surfaces
  bg: string;
  panel: string;
  panelRaised: string;
  line: string;
  lineStrong: string;
  // text
  text: string;
  textMuted: string;
  textDim: string;
  // accent and status
  accent: string;
  /** background of an active toggle */
  accentDim: string;
  /** text and icons drawn on accentDim. The accent itself fails 4.5:1 there, in both themes,
   *  so the pressed state needs its own foreground rather than reusing --accent. */
  accentOn: string;
  /** text drawn on a solid --accent fill */
  accentContrast: string;
  pos: string;
  neg: string;
  // scene
  sceneBg: string;
  sceneFog: string;
  asphalt: string;
  edge: string;
  gridCell: string;
  gridSection: string;
  terrainLo: string;
  terrainMid: string;
  terrainHi: string;
  carBody: string;
  carCarbon: string;
  carGlass: string;
  // phase palette. Deliberately blue/amber/grey rather than the red/green it replaces:
  // red-green is the axis lost in deuteranopia and protanopia, which together affect roughly
  // 8% of men, and reading the phase colouring is the entire job of this tool.
  phaseAccel: string;
  phaseBrake: string;
  phaseCoast: string;
  // scene lighting, tuned per theme so the circuit stays the brightest thing on screen
  lightKey: number;
  lightHemiSky: string;
  lightHemiGround: string;
  lightHemi: number;
}

export const THEMES: Record<ThemeName, ThemeTokens> = {
  dark: {
    bg: "#08090c",
    panel: "#10121a",
    panelRaised: "#171a25",
    line: "#1e2230",
    lineStrong: "#2c3242",
    text: "#e8eaf0",
    textMuted: "#949cad", // 6.8:1 on panel
    textDim: "#767e8e", // 4.6:1 on panel
    accent: "#ff5c1a", // 6.1:1 on panel
    accentDim: "#2e1a10",
    accentOn: "#ff7a45", // 6.4:1 on accentDim
    accentContrast: "#08090c",
    pos: "#3ecf8e",
    neg: "#ff5f56",
    sceneBg: "#08090c",
    sceneFog: "#0a0c11",
    asphalt: "#34383f",
    edge: "#d9dde6",
    gridCell: "#141721",
    gridSection: "#1e2230",
    terrainLo: "#16241c",
    terrainMid: "#2c3324",
    terrainHi: "#4a4636",
    carBody: "#ff5c1a",
    carCarbon: "#15171d",
    carGlass: "#0c1218",
    phaseAccel: "#ffc233",
    phaseBrake: "#3b9dff",
    phaseCoast: "#8b90a0",
    lightKey: 1.5,
    lightHemiSky: "#2a3040",
    lightHemiGround: "#0b0d12",
    lightHemi: 0.8,
  },
  light: {
    bg: "#eef0f3",
    panel: "#ffffff",
    panelRaised: "#f6f7f9",
    line: "#d6dae1",
    lineStrong: "#b8bfc9",
    text: "#14161a",
    textMuted: "#5c6472", // 6.0:1 on panel
    textDim: "#6b7382", // 4.8:1 on panel
    accent: "#d92e14", // 4.8:1 on panel
    accentDim: "#fdeae6",
    accentOn: "#a81f0d", // 6.3:1 on accentDim
    accentContrast: "#ffffff",
    pos: "#0a7d49",
    neg: "#c62828",
    sceneBg: "#eef0f3",
    sceneFog: "#e4e7eb",
    asphalt: "#5a5e66",
    edge: "#ffffff",
    gridCell: "#dfe2e7",
    gridSection: "#c9ced6",
    terrainLo: "#8fa886",
    terrainMid: "#a49f7c",
    terrainHi: "#bdb193",
    carBody: "#d92e14",
    carCarbon: "#2a2d34",
    carGlass: "#4a5560",
    phaseAccel: "#c07800",
    phaseBrake: "#0b6fd0",
    phaseCoast: "#767e8e",
    lightKey: 1.2,
    lightHemiSky: "#f2f4f8",
    lightHemiGround: "#8c8f96",
    lightHemi: 1.0,
  },
};

/**
 * Physical materials: things that have a real-world colour rather than a designed one. Tyre
 * rubber is black in both themes; FIA kerbs are red and white in both themes. These live here
 * anyway so the "no hex outside theme.ts" rule stays a rule with no judgement calls in it.
 */
export const MATERIAL = {
  tyre: "#0a0a0d",
  rim: "#b8bcc6",
  brakeDisc: "#3a3d44",
  brakeGlow: "#ff3a10",
  headlight: "#eef4ff",
  headlightEmissive: "#cfe4ff",
  kerbRed: "#a8202a",
  kerbWhite: "#c8c8ce",
  ghost: "#8a8f9c",
} as const;

// spacing, radius, motion and type are theme-independent
export const SPACE = { s1: 4, s2: 8, s3: 12, s4: 16, s5: 24, s6: 32 } as const;
export const RADIUS = { sm: 2, md: 3, lg: 4 } as const;
export const MOTION = {
  ease: "cubic-bezier(0.22, 1, 0.36, 1)",
  fast: 140,
  base: 240,
  slow: 800,
} as const;
export const FONT = {
  display:
    '"Archivo Variable", "Archivo", ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
} as const;

const CSS_VAR: Record<keyof ThemeTokens, string> = {
  bg: "--bg",
  panel: "--panel",
  panelRaised: "--panel-raised",
  line: "--line",
  lineStrong: "--line-strong",
  text: "--text",
  textMuted: "--text-muted",
  textDim: "--text-dim",
  accent: "--accent",
  accentDim: "--accent-dim",
  accentOn: "--accent-on",
  accentContrast: "--accent-contrast",
  pos: "--pos",
  neg: "--neg",
  sceneBg: "--scene-bg",
  sceneFog: "--scene-fog",
  asphalt: "--asphalt",
  edge: "--edge",
  gridCell: "--grid-cell",
  gridSection: "--grid-section",
  terrainLo: "--terrain-lo",
  terrainMid: "--terrain-mid",
  terrainHi: "--terrain-hi",
  carBody: "--car-body",
  carCarbon: "--car-carbon",
  carGlass: "--car-glass",
  phaseAccel: "--phase-accel",
  phaseBrake: "--phase-brake",
  phaseCoast: "--phase-coast",
  lightKey: "--light-key",
  lightHemiSky: "--light-hemi-sky",
  lightHemiGround: "--light-hemi-ground",
  lightHemi: "--light-hemi",
};

function themeBlock(name: ThemeName): string {
  const t = THEMES[name];
  const decls = (Object.keys(CSS_VAR) as (keyof ThemeTokens)[])
    .map((k) => `  ${CSS_VAR[k]}: ${t[k]};`)
    .join("\n");
  return `:root[data-theme="${name}"] {\n${decls}\n}`;
}

// one stylesheet, generated from the token objects so the CSS and the TS can never drift
function globalCss(): string {
  const space = Object.entries(SPACE)
    .map(([k, v]) => `  --${k}: ${v}px;`)
    .join("\n");
  return `
${themeBlock("dark")}
${themeBlock("light")}

:root {
${space}
  --radius-sm: ${RADIUS.sm}px;
  --radius-md: ${RADIUS.md}px;
  --radius-lg: ${RADIUS.lg}px;
  --ease: ${MOTION.ease};
  --t-fast: ${MOTION.fast}ms;
  --t-base: ${MOTION.base}ms;
  --t-slow: ${MOTION.slow}ms;
  --font-display: ${FONT.display};
  --font-mono: ${FONT.mono};
  color-scheme: dark;
}
:root[data-theme="light"] { color-scheme: light; }

html, body, #root {
  margin: 0;
  height: 100%;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-display);
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
}

/* numerals never reflow as they tick */
.tnum { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

button, select, input { font-family: inherit; font-size: inherit; color: inherit; }
button { cursor: pointer; }

/* one focus treatment for everything. Never removed, never colour-only. */
:focus { outline: none; }
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

/* screen-reader-only, still in the accessibility tree (display:none would hide it) */
.sr-only {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.skip-link {
  position: absolute; left: var(--s2); top: -60px; z-index: 100;
  padding: var(--s2) var(--s3);
  background: var(--panel); border: 1px solid var(--accent);
  border-radius: var(--radius-lg); color: var(--text); text-decoration: none;
  transition: top var(--t-fast) var(--ease);
}
.skip-link:focus { top: var(--s2); }

::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--line-strong); border-radius: 4px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
`;
}

const STYLE_ID = "track-side-tokens";

function ensureStylesheet(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = globalCss();
  document.head.appendChild(el);
}

const STORAGE_KEY = "track-side:theme";

// dark is the design's home: the circuit is lit to be the brightest thing on screen, and the
// light theme is the alternative rather than the default. Only an explicit stored choice moves
// it, so a light OS preference does not quietly ship a different product.
function initialTheme(): ThemeName {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" ? "light" : "dark";
}

interface ThemeContextValue {
  theme: ThemeName;
  tokens: ThemeTokens;
  setTheme: (t: ThemeName) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    ensureStylesheet();
    return initialTheme();
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      tokens: THEMES[theme],
      setTheme: setThemeState,
      toggleTheme: () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
    }),
    [theme],
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

/** resolved token values, for canvas 2D and three.js which cannot read CSS variables. */
export function useThemeTokens(): ThemeTokens {
  return useTheme().tokens;
}

/** a live media query. Reading matchMedia once at module scope would miss runtime changes: a
 *  rotated phone, a resized window, or an OS accessibility setting flipped mid-session. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/** below this the side rail cannot coexist with a usable viewport and becomes a drawer. */
export function useIsNarrow(): boolean {
  return useMediaQuery("(max-width: 760px)");
}

/** hex string to a [0..1] rgb triple, for three.js vertex-colour buffers. */
export function hexToRgb(hex: string, out: [number, number, number]): void {
  const h = hex.replace("#", "");
  out[0] = parseInt(h.slice(0, 2), 16) / 255;
  out[1] = parseInt(h.slice(2, 4), 16) / 255;
  out[2] = parseInt(h.slice(4, 6), 16) / 255;
}
