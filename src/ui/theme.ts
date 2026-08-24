// the single source of colour, spacing, type and motion for the whole app. Two themes, one
// token vocabulary. Nothing else in src/ may contain a hex literal: the DOM reads the tokens as
// CSS custom properties, while the canvas charts and the three.js scene read the same values as
// plain strings through useThemeTokens (neither can resolve var()).
//
// contrast: every text-on-surface pair below was measured against WCAG 2.2 1.4.3. The muted and
// dim greys are exactly as light/dark as they need to be to clear 4.5:1 on their own panel, which
// is why they look less subtle than the values they replaced.

import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  // phase palette: blue pencil accelerating, red pencil braking, graphite holding. These are the
  // two colours actually on an engineer's marked-up sheet, and they are chosen over the
  // traffic-light reading for a reason that outranks familiarity.
  //
  // red against green is the axis lost in deuteranopia and protanopia, roughly 8% of men, and
  // phase is the core encoding of this entire tool. Red against blue survives all three common
  // deficiencies. The pair is separated on lightness as well (roughly 51 against 35 in L*), so
  // the hue is never doing the work alone; do not "balance" these to equal lightness.
  //
  // coast sits at low chroma so it recedes, leaving the line reading as two active phases
  // separated by gaps rather than three competing bands.
  phaseAccel: string;
  phaseBrake: string;
  phaseCoast: string;
  // scene lighting, tuned per theme so the circuit stays the brightest thing on screen
  lightKey: number;
  /** the key light's colour, and the one place the lamp is a light rather than a surface. It is
   *  white in daylight, so this token looks redundant there; it is not. Leaving the key at
   *  three.js's default white while every reflectance in the scene was dimmed is what made the
   *  road under the lamp brighter than the sheet it is printed on. */
  lightKeyTint: string;
  lightHemiSky: string;
  lightHemiGround: string;
  lightHemi: number;
}

export const THEMES: Record<ThemeName, ThemeTokens> = {
  // the same stock, under a work lamp. **This rendition is derived from `light`, not designed
  // beside it**, which is why the two blocks agree token for token: the sheet does not turn
  // brown at night, it is the same paper reflecting less light.
  //
  // The transform, applied to every reflectance below and reproducible from the light values:
  //
  //     linear_rgb * t * [1.10, 1.00, 0.74]
  //
  // The vector is the lamp's chromaticity, partly adapted to, normalised to luminance 1 so it
  // tints without dimming. `t` is the illumination: **0.57 inside the cone**, which lands the
  // sheet at L* 79 instead of 98, and **0.022 for `bg`**, the binder out on the desk where the
  // lamp does not reach. Nothing here is a separate palette; change a light value and this one
  // follows.
  //
  // Two consequences worth stating, because they look like mistakes and are not:
  //
  //   1. **Ink stays dark.** Paper under a lamp is still the brightest thing in the frame, so
  //      this is not an inverted interface, and it is not "dark mode" in the low-luminance
  //      sense. The toggle says "read under the work lamp" because that is the whole claim.
  //   2. **The printed grid still reads cool.** Blue ink under tungsten loses most of its
  //      excitation, but the paper loses it too, so the b* gap between grid and sheet survives
  //      the transform almost exactly (-10.8 daylight, -10.8 lamp). The eye adapts to the sheet
  //      it is reading, not to D65.
  //
  // Contrast is the one place physics had to be overruled. WCAG's flare term is a fixed +0.05,
  // so dimming the illumination costs contrast that no amount of correctness gives back. Every
  // pair lands within 0.2 of its daylight counterpart except two, which are darkened by hand and
  // marked below.
  dark: {
    bg: "#222018", // the binder, at 2.2% of the lamp
    panel: "#ccc3a8",
    panelRaised: "#c6bc9e", // the canary duplicate, still yellow: b* 16.5 against the sheet's 14.7
    line: "#969890",
    lineStrong: "#202221",
    text: "#101110", // 10.8:1 on panel
    textMuted: "#3e403f", // 5.9:1 on panel
    textDim: "#50504f", // 4.6:1 on panel. Darkened by hand from #565755, which fell to 4.13:1
    accent: "#a20a1c", // red pencil, 4.6:1 on panel
    accentDim: "#c9aa98",
    accentOn: "#730612",
    accentContrast: "#ccc3a8",
    pos: "#144769", // blue pencil, 5.6:1 on panel
    neg: "#a20a1c",
    sceneBg: "#ccc3a8",
    sceneFog: "#ccc3a8",
    asphalt: "#6f7681",
    edge: "#101110",
    gridCell: "#bcb193",
    gridSection: "#a8a698",
    // the diagram block is printed in both renditions, so these are the light theme's contour
    // tints under the same lamp rather than a landscape that has turned to night
    terrainLo: "#b2b1a0",
    terrainMid: "#929791",
    terrainHi: "#6a7475",
    terrainGlow: 0.8,
    // there is no night sky here any more. The plate is a figure printed into a sheet, so the
    // dome is the sheet's own colour, there is no sun disc, and stars on a printed page were the
    // clearest thing left saying "3D scene" rather than "drawing".
    skyZenith: "#ccc3a8",
    skySun: "#ccc3a8",
    skySunIntensity: 0,
    skyHorizonSharp: 1,
    skyStars: 0,
    fogDensityK: 0.13,
    // reflectances, not renditions: the aprons and the paint are lit by the scene's own lights,
    // and those carry the lamp. Dimming these as well would dim the figure twice.
    apronLip: "#e6e2d8",
    apronGravel: "#ddd6c6",
    apronGrass: "#dfe4d8",
    carBody: "#c8102e",
    carCarbon: "#3a4048",
    carGlass: "#aebccd",
    // red and blue pencil, the two colours actually on an engineer's sheet. Red against blue
    // survives all three common colour-vision deficiencies where red against green does not, and
    // the pair is separated on lightness as well (L* 39 against 28 under the lamp, 51 against 35
    // in daylight) so the hue is never doing the work alone. The donated discipline goes further:
    // phase is also carried by stroke weight, so a monochrome print of this screen still reads.
    phaseAccel: "#246085", // 3.9:1 on panel, a channel rather than text
    phaseBrake: "#880a19", // 5.7:1 on panel
    phaseCoast: "#6b6b64", // 3.1:1, recedes. Darkened by hand from #6f6f67, which fell to 2.88:1
    // the intensities are the light theme's, unchanged. The lamp lives in the colours, so the
    // figure under it is the daylight figure at 57%, which is what reading the same page in a
    // darker room actually does.
    lightKey: 1.55,
    lightKeyTint: "#cfc7ae",
    lightHemiSky: "#cfc7ae",
    lightHemiGround: "#aea387",
    lightHemi: 1.6,
  },
  // the white top sheet, in daylight. This is the primary rendition and the default: the physical
  // scene is an engineer at a laptop reading something they would otherwise read on paper, and
  // paper is read in light.
  light: {
    bg: "#d6d2c7", // the manila binder the sheet sits on
    panel: "#fbfaf7", // bond paper, deliberately not cream
    panelRaised: "#f4f1e8", // the canary duplicate
    line: "#b9c4d4", // the printed grid, process blue at working strength
    lineStrong: "#2a2f36",
    text: "#16191d", // 17.3:1 on panel
    textMuted: "#4e5560", // 7.2:1 on panel
    textDim: "#6b7280", // 4.6:1 on panel
    accent: "#c8102e", // red pencil, 5.7:1 on panel
    accentDim: "#f7dbe0",
    accentOn: "#8f0b20",
    accentContrast: "#fbfaf7",
    pos: "#1b5e9c", // blue pencil, 6.5:1 on panel
    neg: "#c8102e",
    sceneBg: "#fbfaf7",
    sceneFog: "#fbfaf7",
    asphalt: "#6f7681",
    edge: "#16191d",
    gridCell: "#e7e3d8",
    gridSection: "#cfd6e0",
    terrainLo: "#dbe3ec",
    terrainMid: "#b4c3d6",
    terrainHi: "#8496ae",
    terrainGlow: 0.8,
    skyZenith: "#fbfaf7",
    skySun: "#fbfaf7",
    skySunIntensity: 0,
    skyHorizonSharp: 1,
    skyStars: 0,
    // paper-coloured fog on a paper page hides more than the terrain plate's far edge: at
    // overview distance it was dissolving the far half of the circuit into the sheet, leaving
    // corner labels hanging over blank paper. The plate's tints are already within a few percent
    // of the ground, so it needs almost no haze to lose its own edge.
    fogDensityK: 0.13,
    apronLip: "#e6e2d8",
    apronGravel: "#ddd6c6",
    apronGrass: "#dfe4d8",
    carBody: "#c8102e",
    carCarbon: "#3a4048",
    carGlass: "#aebccd",
    phaseAccel: "#2f7dc4", // 4.2:1 on paper, L* 51
    phaseBrake: "#a8102a", // 7.4:1 on paper, L* 35
    phaseCoast: "#8a9099", // 3.1:1 on paper, recedes
    lightKey: 1.55,
    lightKeyTint: "#ffffff",
    lightHemiSky: "#ffffff",
    lightHemiGround: "#d6d2c7",
    lightHemi: 1.6,
  }
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
// paper is cut square. Nothing in a run book has a rounded corner, and the 2-to-4px radii that
// were here are the single cheapest tell that a surface was assembled from a component library
// rather than drawn.
export const RADIUS = { sm: 0, md: 0, lg: 0 } as const;
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
  lightKeyTint: "--light-key-tint",
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

/* the last platform control drawing its own mark: a disclosure triangle at the host's weight,
   inside a world that draws its own. Hidden here, redrawn in the summary itself. */
summary { list-style: none; }
summary::-webkit-details-marker { display: none; }
.ts-marker { transition: transform var(--t-fast) var(--ease); }
details[open] > summary .ts-marker { transform: rotate(90deg); }
@media (prefers-reduced-motion: reduce) { .ts-marker { transition: none; } }

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
//
// ?theme= wins over the stored choice, because a link that says "look at this in the light
// theme" has to survive being opened by someone whose last session was dark. It deliberately
// does not write to storage: following a link should not repaint the recipient's next visit.
function urlTheme(): ThemeName | null {
  const t = new URLSearchParams(window.location.search).get("theme");
  return t === "light" || t === "dark" ? t : null;
}

function themeCameFromUrl(): boolean {
  return urlTheme() !== null;
}

function initialTheme(): ThemeName {
  const fromUrl = urlTheme();
  if (fromUrl) return fromUrl;
  const stored = localStorage.getItem(STORAGE_KEY);
  // the top sheet is the default now, not the lamp. The scene the product is actually used in is
  // an engineer at a laptop in daylight reading a working document, and that forces light; dark
  // is the same run book under a work lamp, kept as a real choice rather than as the default.
  return stored === "dark" ? "dark" : "light";
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
  // a theme that arrived by link is not a choice the visitor made, so the first pass skips the
  // write. Toggling afterwards is a choice, and does persist.
  const fromLink = useRef(themeCameFromUrl());

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    if (fromLink.current) {
      fromLink.current = false;
      return;
    }
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
