// hex and sRGB floats to three's LINEAR working space, for buffers written imperatively.
//
// theme.ts's hexToRgb divides by 255 and stops. That is correct for a CSS string and for
// anything handed to three as a *string* or a Color, because r3f's applyProps routes those
// through Color.setStyle(style, SRGBColorSpace) and ColorManagement converts them. It is wrong
// for a vertex-colour buffer: three treats the floats in an attribute as already linear, then
// applies a linear -> sRGB conversion on output, which brightens and desaturates every colour
// written that way. phaseAccel #35d96a came out pale mint instead of green; the terrain's
// elevation ramp came out milky sage. Anything going into setColors or setAttribute goes
// through here instead.
//
// This lives outside theme.ts so theme.ts stays free of a three import: the "no hex literals
// outside theme.ts" rule is about literals, not about conversion code.

import * as THREE from "three";

const scratch = new THREE.Color();

/** hex string to a [0..1] LINEAR rgb triple. */
export function hexToLinearRgb(hex: string, out: [number, number, number]): void {
  scratch.setStyle(hex, THREE.SRGBColorSpace);
  out[0] = scratch.r;
  out[1] = scratch.g;
  out[2] = scratch.b;
}

/** the same conversion for values already in 0..1 sRGB, e.g. a matplotlib colormap's stops. */
export function srgbToLinearRgb(
  rgb: readonly [number, number, number],
  out: [number, number, number],
): void {
  scratch.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
  out[0] = scratch.r;
  out[1] = scratch.g;
  out[2] = scratch.b;
}
