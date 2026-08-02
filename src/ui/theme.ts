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
  /** the horizon, and the only definition of it. Three consumers that must never disagree: the
   *  exponential fog's colour, the sky dome's horizon band, and the whole below-horizon half of
   *  that dome. Fully fogged geometry lands on exactly this value, so the finite terrain plate's
   *  far edge is the same colour as the sky it ends against and its silhouette is unfindable. */
  sceneFog: string;
  asphalt: string;
  edge: string;
  gridCell: string;
  gridSection: string;
  terrainLo: string;
  terrainMid: string;
  terrainHi: string;
  /** multiplier on the terrain ramp. The point-and-wire layers want more punch than a shaded
   *  surface does; the light theme goes the other way and sits darker than the ground. */
  terrainGlow: number;
  // sky dome. One shader for both themes, so the only difference between a night sky and a day
  // sky is these values. drei's <Sky> could not do this: it is the Preetham *daylight* model and
  // has no night mode at all, which is why dark theme used to render a near-white sky.
  skyZenith: string;
  skySun: string;
  skySunIntensity: number;
  /** pow() exponent on the vertical ramp. Below 1 it compresses toward the horizon, so most of
   *  the dome is zenith colour and the variation lives in the last few degrees. A linear ramp
   *  puts the midtone at 45 degrees, which reads as a painted backdrop rather than as air. */
  skyHorizonSharp: number;
  /** star brightness. 0 removes the field entirely, which is the light theme. */
  skyStars: number;
  /** fogExp2 density is this over the circuit's extent, so Spa and Monza haze identically
   *  despite being different sizes. */
  fogDensityK: number;
  // apron zones, by lateral metres out from the road edge: 0-0.4 lip, 0.4-12 run-off, 12-32 grass
  apronLip: string;
  apronGravel: string;
  apronGrass: string;
  carBody: string;
  carCarbon: string;
  carGlass: string;
  // phase palette: green accelerating, red braking, neutral holding. the traffic-light reading,
  // which is what nearly everyone expects a racing line to mean without being told.
  //
  // red-green is also the axis lost in deuteranopia and protanopia, roughly 8% of men, so the
  // two are separated on a **second** channel as well: the green is much lighter than the red
  // (roughly 76 vs 55 in perceptual lightness). A dichromat sees both as similar hues but at
  // clearly different brightness, so the line stays readable without relying on the hue alone.
  // Do not "balance" these to equal lightness; the difference is the accessibility mechanism.
  //
  // coast sits at low chroma so it recedes, leaving the line reading as two active phases
  // separated by gaps rather than three competing bands.
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
    sceneBg: "#0b0e14",
    sceneFog: "#131a26",
    asphalt: "#26292f",
    edge: "#d9dde6",
    gridCell: "#141721",
    gridSection: "#1e2230",
    // these read as *rendered* colours now. The values they replaced were written straight into
    // a vertex buffer without an sRGB decode, so #16241c actually reached the screen as a milky
    // #718e7e that nobody authored; correcting the conversion made the same hexes near-black,
    // hence the retune. Deeper and more saturated than what shipped, on purpose: the racing line
    // is the one thing in the scene allowed to glow, and the ground has to lose that contest.
    terrainLo: "#2e5c42",
    terrainMid: "#5a6640",
    terrainHi: "#8b8059",
    terrainGlow: 1.15,
    skyZenith: "#05070f",
    skySun: "#ff8a3d",
    skySunIntensity: 0.3,
    skyHorizonSharp: 0.4,
    skyStars: 0.55,
    fogDensityK: 0.62,
    // these are *unlit* base tones and the scene puts about 2.3 of combined key, hemisphere and
    // environment on them, so they land a good deal lighter than they read here. Tuned by
    // screenshot: gravel has to be clearly lighter than the asphalt without becoming the
    // brightest thing in the frame, and it has to stay dark enough that the white edge line
    // painted at the road's boundary still reads against it.
    apronLip: "#55585d",
    apronGravel: "#4e483d",
    apronGrass: "#26331f",
    carBody: "#ff5c1a",
    carCarbon: "#15171d",
    carGlass: "#0c1218",
    phaseAccel: "#35d96a",
    phaseBrake: "#e8402e",
    phaseCoast: "#5d6472",
    lightKey: 1.5,
    lightHemiSky: "#1c2534",
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
    sceneBg: "#dfe4ea",
    sceneFog: "#d7e2ec",
    asphalt: "#4c5158",
    edge: "#ffffff",
    gridCell: "#dfe2e7",
    gridSection: "#c9ced6",
    terrainLo: "#7f9a76",
    terrainMid: "#95906f",
    terrainHi: "#aa9f81",
    terrainGlow: 0.85,
    skyZenith: "#7fa9d6",
    skySun: "#fff4dc",
    skySunIntensity: 0.18,
    skyHorizonSharp: 0.55,
    skyStars: 0,
    // more haze than the dark theme needs: a dark terrain edge against a light sky has further
    // to travel to disappear than a dark edge against a dark one
    fogDensityK: 0.7,
    apronLip: "#83888f",
    apronGravel: "#6f6552",
    apronGrass: "#48603d",
    carBody: "#d92e14",
    carCarbon: "#2a2d34",
    carGlass: "#4a5560",
    phaseAccel: "#1a9e4b",
    phaseBrake: "#c11f10",
    phaseCoast: "#737a88",
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
  // easeOutQuint: most of the travel happens early, so a panel feels like it is settling into
  // place rather than decelerating into it. `base` is the panel open/close duration; at 240 ms
  // the rail arrived before the eye had followed it, which read as a jump rather than a slide.
  ease: "cubic-bezier(0.22, 1, 0.36, 1)",
  fast: 140,
  base: 300,
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
  terrainGlow: "--terrain-glow",
  skyZenith: "--sky-zenith",
  skySun: "--sky-sun",
  skySunIntensity: "--sky-sun-intensity",
  skyHorizonSharp: "--sky-horizon-sharp",
  skyStars: "--sky-stars",
  fogDensityK: "--fog-density-k",
  apronLip: "--apron-lip",
  apronGravel: "--apron-gravel",
  apronGrass: "--apron-grass",
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
