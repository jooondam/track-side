// the dark rendition is *derived* from the light one, and this is what keeps that true.
//
// theme.ts states the transform in a comment. A comment cannot stop someone hand-nudging one
// dark token and leaving the other 30 behind, which is how the previous dark theme drifted into
// being a separate brown palette that shared none of the light theme's reasoning. So the
// transform is re-run here against the shipped light values and compared to the shipped dark
// ones, and the only permitted departures are the two named below.

import { describe, expect, it } from "vitest";
import { THEMES, type ThemeName, type ThemeTokens } from "./theme";

const LAMP = [1.1, 1.0, 0.74]; // the lamp's chromaticity, normalised to luminance 1
const POOL = 0.57; // illumination on the sheet
const DESK = 0.022; // illumination on the binder, out on the desk

const toLinear = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => {
  const c = Math.min(Math.max(v, 0), 1);
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
};
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (rgb: number[]) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

/** the light value as it would look at illumination `t` under the lamp. */
function underLamp(light: string, t: number): string {
  return hex(channels(light).map((c, i) => toSrgb(toLinear(c) * t * LAMP[i])));
}

function luminance(h: string): number {
  const [r, g, b] = channels(h).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast. The +0.05 is a fixed flare term, which is why dimming costs contrast. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// everything printed on, or emitted by, the sheet: it is inside the lamp's cone
const POOL_KEYS = [
  "panel", "panelRaised", "line", "lineStrong", "text", "textMuted", "accent", "accentDim",
  "accentOn", "accentContrast", "pos", "neg", "sceneBg", "sceneFog", "edge", "gridCell",
  "gridSection", "terrainLo", "terrainMid", "terrainHi", "skyZenith", "skySun", "phaseAccel",
  "phaseBrake", "lightKeyTint", "lightHemiSky", "lightHemiGround",
] as const satisfies readonly (keyof ThemeTokens)[];

// reflectances of things the scene's own lights fall on. The lights carry the lamp, so dimming
// these as well would dim the figure twice.
const REFLECTANCE_KEYS = [
  "asphalt", "apronLip", "apronGravel", "apronGrass", "carBody", "carCarbon", "carGlass",
] as const satisfies readonly (keyof ThemeTokens)[];

// illumination is not a time of day: the figure is printed in both renditions, so its geometry,
// haze and light levels are shared and only the colours move
const SHARED_NUMERIC_KEYS = [
  "terrainGlow", "skySunIntensity", "skyHorizonSharp", "skyStars", "fogDensityK", "lightKey",
  "lightHemi",
] as const satisfies readonly (keyof ThemeTokens)[];

// darkened by hand, and only downward. WCAG's flare term is fixed, so the derived values landed
// under their floors and physics had no way to give the contrast back.
const HAND_DARKENED = { textDim: 4.5, phaseCoast: 3.0 } as const;

describe("the dark rendition is derived from the light one", () => {
  const light = THEMES.light;
  const dark = THEMES.dark;

  it.each(POOL_KEYS)("%s is the light value at 57%% under the lamp", (key) => {
    // one step of tolerance per channel: this is a claim about the transform, not about a
    // particular rounding of it
    const want = channels(underLamp(light[key] as string, POOL));
    const got = channels(dark[key] as string);
    got.forEach((c, i) => expect(Math.abs(c - want[i]), `${key} channel ${i}`).toBeLessThanOrEqual(1));
  });

  it("bg is the binder out on the desk, at 2.2%", () => {
    expect(dark.bg).toBe(underLamp(light.bg, DESK));
  });

  it.each(REFLECTANCE_KEYS)("%s is a reflectance and is not dimmed", (key) => {
    expect(dark[key]).toBe(light[key]);
  });

  it.each(SHARED_NUMERIC_KEYS)("%s is shared, because both renditions are printed", (key) => {
    expect(dark[key]).toBe(light[key]);
  });

  it.each(Object.entries(HAND_DARKENED))("%s is darkened from its derived value, never lightened", (key, floor) => {
    const k = key as keyof typeof HAND_DARKENED;
    const derived = underLamp(light[k], POOL);
    expect(luminance(THEMES.dark[k])).toBeLessThan(luminance(derived));
    expect(contrast(THEMES.dark[k], THEMES.dark.panel)).toBeGreaterThanOrEqual(floor);
  });

  it("keeps the sheet the brightest thing in the frame, and the ink dark", () => {
    // the whole claim of this rendition: paper under a lamp is still paper. If this ever flips,
    // the theme has become an inverted interface and the comments in theme.ts are lies.
    expect(luminance(dark.panel)).toBeGreaterThan(luminance(dark.text));
    expect(luminance(dark.panel)).toBeGreaterThan(luminance(dark.bg));
  });
});

// the pairs theme.ts annotates with a ratio, checked rather than asserted in a comment
const TEXT_PAIRS: [keyof ThemeTokens, keyof ThemeTokens][] = [
  ["text", "panel"], ["textMuted", "panel"], ["textDim", "panel"],
  ["accent", "panel"], ["pos", "panel"], ["neg", "panel"],
  ["textMuted", "panelRaised"], ["accentOn", "accentDim"], ["accentContrast", "accent"],
];

// phase is a data channel, not body text, so the bar is WCAG 1.4.11's 3:1. Coast sits right on
// it on purpose: it has to recede without disappearing.
const CHANNEL_PAIRS: [keyof ThemeTokens, keyof ThemeTokens][] = [
  ["phaseAccel", "panel"], ["phaseBrake", "panel"], ["phaseCoast", "panel"],
];

// the canary duplicate is darker than the top sheet in both renditions, so it gets its own pass.
// primitives.tsx's CANARY surface rebinds two tokens to clear these floors; the raw values are
// asserted here as *failing*, because that is the whole reason the rebinding exists and a future
// palette change that quietly fixed them should force someone to read this.
describe.each(["light", "dark"] as ThemeName[])("%s canary duplicate", (name) => {
  const t = THEMES[name];
  it("pos needs no rebinding", () => {
    expect(contrast(t.pos, t.panelRaised)).toBeGreaterThanOrEqual(4.5);
  });
  it("the rebound tokens clear the floor on it", () => {
    // CANARY maps --text-dim to the muted tone and --neg to the deeper pencil
    expect(contrast(t.textMuted, t.panelRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.accentOn, t.panelRaised)).toBeGreaterThanOrEqual(4.5);
  });
  it("textDim raw does not, which is why CANARY rebinds it", () => {
    expect(contrast(t.textDim, t.panelRaised)).toBeLessThan(4.5);
  });
});

it("neg raw fails on the canary under the lamp, which is why CANARY rebinds it", () => {
  // this was shipped: the ghost's delta readout in the rail is drawn in var(--neg) and sits on
  // the canary, so the lamp rendition was serving it at 4.27:1 until CANARY was introduced
  expect(contrast(THEMES.dark.neg, THEMES.dark.panelRaised)).toBeLessThan(4.5);
  expect(contrast(THEMES.light.neg, THEMES.light.panelRaised)).toBeGreaterThanOrEqual(4.5);
});

describe.each(["light", "dark"] as ThemeName[])("%s contrast", (name) => {
  const t = THEMES[name];
  it.each(TEXT_PAIRS)("%s on %s clears 4.5:1", (fg, bg) => {
    expect(contrast(t[fg] as string, t[bg] as string)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(CHANNEL_PAIRS)("%s on %s clears 3:1", (fg, bg) => {
    expect(contrast(t[fg] as string, t[bg] as string)).toBeGreaterThanOrEqual(3);
  });
  it("keeps accelerating and braking apart on lightness, not only on hue", () => {
    const lstar = (h: string) => {
      const y = luminance(h);
      return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : y * 903.3;
    };
    expect(Math.abs(lstar(t.phaseAccel) - lstar(t.phaseBrake))).toBeGreaterThan(8);
  });
});
