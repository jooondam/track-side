// the type scale is closed, and this is what keeps it closed.
//
// Before this, the viewer rendered ten sizes, seven letterspacings and four weights, accumulated a
// site at a time. Nothing stopped the eleventh. These tests are cheap and blunt on purpose: the
// scale is only a scale if adding to it is harder than reusing it.

import { describe, expect, it } from "vitest";
import { TYPE } from "./theme";

describe("TYPE", () => {
  it("has four sizes, two trackings and three weights", () => {
    expect(Object.keys(TYPE.size)).toHaveLength(4);
    expect(Object.keys(TYPE.track)).toHaveLength(2);
    expect(Object.keys(TYPE.weight)).toHaveLength(3);
  });

  it("puts nothing below the interface's own 12px floor", () => {
    // primitives.tsx has claimed 12 as the smallest type for as long as it has existed, but that
    // only described the DOM: the canvas charts drew at 9 and 10. The canvases read TYPE now, so
    // this assertion is the claim and the artifact agreeing.
    for (const [name, px] of Object.entries(TYPE.size)) {
      expect(px, `${name} is below the floor`).toBeGreaterThanOrEqual(12);
    }
  });

  it("keeps the sizes ordered and distinct", () => {
    const sizes = Object.values(TYPE.size);
    expect([...new Set(sizes)]).toHaveLength(sizes.length);
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
  });
});

// the UI is styled inline rather than in a stylesheet, so a literal is the easy thing to reach
// for and a scale is only enforced by looking. This walks the source through vite's own raw
// import rather than node's fs, so it needs no node types and works in any vitest environment.
const SOURCES = import.meta.glob("./*.tsx", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

function uiSources(): { file: string; text: string }[] {
  return Object.entries(SOURCES).map(([file, text]) => ({ file, text }));
}

describe("no type literals escape the scale", () => {
  it("has no numeric fontSize outside TYPE", () => {
    const offenders: string[] = [];
    for (const { file, text } of uiSources()) {
      for (const m of text.matchAll(/fontSize:\s*(\d+)/g)) {
        offenders.push(`${file}: fontSize: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("has no hardcoded font shorthand in the canvas charts", () => {
    // the charts draw with ctx.font, which takes a CSS shorthand string. Four of them carried
    // their own copy of the font stack, so a change to FONT never reached them.
    const offenders: string[] = [];
    for (const { file, text } of uiSources()) {
      for (const m of text.matchAll(/ctx\.font\s*=\s*["'](\d+)/g)) {
        offenders.push(`${file}: ctx.font = "${m[1]}px …"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("has no letterSpacing literal outside TYPE", () => {
    const offenders: string[] = [];
    for (const { file, text } of uiSources()) {
      for (const m of text.matchAll(/letterSpacing:\s*["']([^"']+)["']/g)) {
        // -0.02em on the landing's monumental is a display-size optical correction, not tracking
        if (m[1].startsWith("-")) continue;
        offenders.push(`${file}: letterSpacing: "${m[1]}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
