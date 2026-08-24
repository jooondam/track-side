// landscape context as a stippled point-and-wire field that recedes to nothing.
//
// Three layers, and **the visible two no longer live on the heightfield's grid**:
//
//   1. an occluder plate on the heightfield's own rectangular grid plus its skirt, coloured close
//      to the background. It is there to *occlude*, not to be seen: without it the circuit reads
//      through its own hills and the far side of the lap hangs in front of the near side. Its
//      rectangle was never visible, and its geometry backs the road clearance guarantee.
//   2. a wireframe over the inner lattice, dim, gone before its own boundary.
//   3. dots over the whole field, coloured by elevation.
//
// Layers 2 and 3 are built by ./terrainGrid's buildFieldLayout: a circular lattice around the
// circuit that dissolves into scatter rings further out. They used to sit on the heightfield's
// grid, and that drew its 1:1.6 rectangle onto the screen as a bright plateau with a hard edge --
// density is brightness for a fixed-size sprite, and the skirt thinned 16x on the short axis
// while the fade, anchored on the half-diagonal, had not started. The full measurement is in
// terrainGrid.ts. Circles cannot produce a straight edge, which is the point.
//
// Three things keep it looking like landscape rather than like a diagram:
//
//   - **jitter.** An exact grid beats against the pixel raster into diagonal moire streaks.
//   - **spread.** A dot's pixel area scales with the ground area it stands for, so thinning reads
//     as recession rather than as a sudden darkness past the lattice.
//   - **a radial fade with an in-material blur.** Past fadeStart the dots grow, dim and soften
//     until they are gone; the wire goes first, so the field reads lattice, then dots, then
//     nothing. Growing a sprite while dropping its alpha spreads the same energy over more
//     pixels, which is a blur, done with no render target and no postprocessing pass (0.2b).
//
// And a guarantee underneath all of it, which lives in two other files: fogExp2 carries everything
// at that range to exactly tokens.sceneFog, and SkyDome paints its entire below-horizon half
// with the same token. So the plate's far edge and the sky it ends against are the same colour
// by construction, and the silhouette cannot be found from any camera OrbitControls allows.
//
// The grid maths lives in ./terrainGrid so it can be tested without r3f or a GPU.

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Terrain } from "../assets";
import { useThemeTokens } from "../ui/theme";
import { hexToLinearRgb } from "./colorspace";
import {
  DROP_BELOW_ROAD,
  SKIRT_RINGS,
  buildFieldLayout,
  buildGridAxis,
  WIRE_STRIDE,
  fieldRadii,
  plateHeightAt,
  plateVertexHeight,
} from "./terrainGrid";

// DROP_BELOW_ROAD lives in ./terrainGrid with the rest of the grid maths, so the clearance it
// guarantees can be asserted against the shipped heightfields in node. See the note there.


// shared shader preamble. The distance that drives everything is **horizontal**: the elevation
// exaggeration slider is a Y scale on this group, and a 3D distance would make the fade radius
// breathe every time the user dragged it.
const FADE_CHUNK = /* glsl */ `
uniform vec3  uAnchor;
uniform float uFadeStart;
uniform float uFadeEnd;

float groundDistance( vec3 worldPos ) {
  return length( worldPos.xz - uAnchor.xz );
}

// how edge-on the ground is from here: a dimming, not a cutoff.
//
// The problem it solves is real. The dots are a fixed pixel size and do not attenuate, so as the
// ground plane foreshortens toward the horizon more and more of them stack into the same pixel,
// and an additive layer just adds until it clips into two blinding bars. Dimming by the view
// angle is the physically right answer: a mat of points seen edge-on covers less solid angle per
// point, not more.
//
// **But it used to solve it by deleting the ground.** smoothstep(0.003, 0.05, ratio) reaches zero
// below 0.003, and from a chase camera 2.6 m up that is everything past about 300 m: measured,
// 100 m away was 52% dimmed, 150 m 78%, 300 m 96%. That was survivable while 32 m of apron framed
// the road; with the apron gone it left the chase view as a road floating in black.
//
// So it keeps a floor. The horizon still loses three quarters of its brightness, which is what
// stops the pile-up, and the ground under a low camera is still ground.
float grazeFade( vec3 worldPos ) {
  vec3  toEye = cameraPosition - worldPos;
  float len   = max( length( toEye ), 1e-4 );
  return mix( 0.26, 1.0, smoothstep( 0.002, 0.075, abs( toEye.y ) / len ) );
}
`;

// three's <fog_fragment> does mix(rgb, fogColor, f), which is right for an opaque surface: these
// layers blend normally onto a paper-coloured sky, so hazing them toward the fog colour is what
// distance looks like.
//
// There was an ADDITIVE_FOG path here for the dark theme, which attenuated alpha instead of
// tinting rgb, because mixing a non-black fog colour into an additive sprite makes the distant
// field *brighter* rather than hazier. Both renditions blend normally now, so it is gone. Bring
// it back with the blending mode or not at all: the two are one decision.
const FOG_CHUNK = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( -fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;

const DOT_VERTEX = /* glsl */ `
uniform float uPixelRatio;
uniform float uSize;
uniform float uFarGrow;
// motion lives here rather than in FADE_CHUNK: since the sweep was removed the dots are the only
// layer with a time-varying term, and a uniform the wire declares but never reads is a lie about
// what that shader does.
uniform float uTwinkle;
uniform float uTime;
uniform float uMotion;

attribute vec3  aTint;
attribute float aPhase;
attribute float aSpread;

varying vec3  vTint;
varying float vAlpha;
varying float vSoft;

#include <common>
#include <fog_pars_vertex>
${FADE_CHUNK}

void main() {
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;

  vec3  worldPos = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
  float d        = groundDistance( worldPos );
  float far      = smoothstep( uFadeStart, uFadeEnd, d );
  vSoft = far;

  // **Shimmer, not a pulse.** What was here was a crest sweeping outward from the anchor every
  // 11 s, and it was broken in a way no amount of tuning would fix: ringPulse divided by each
  // material's own uFadeEnd, and the dot and wire layers have different ones, so the same crest
  // swept at 501 m/s on the dots and 311 m/s on the wire and the two could never line up. It was
  // also a 28% brightening lasting 0.9 s once every 11 s, which is close to imperceptible, and it
  // was a radar sweep competing with the racing line for the eye. Deleted rather than repaired.
  //
  // The twinkle is what is left, and it is now actually visible. Each dot gets its own phase and
  // its own rate from the same hash, so the field breathes unevenly instead of pulsing in unison:
  // a single shared rate reads as a global flicker no matter how small the amplitude.
  float rate = 0.35 + 0.5 * aPhase;
  float tw   = uMotion * uTwinkle * sin( uTime * rate + aPhase * 6.2831853 );

  vTint  = aTint * ( 1.0 + tw );
  vAlpha = ( 1.0 - far ) * mix( 1.0, 0.55, far ) * grazeFade( worldPos );

  // sizeAttenuation is deliberately absent and cannot be recovered here: three only maintains
  // the size and scale uniforms for material.isPointsMaterial, so defining
  // USE_SIZEATTENUATION on a ShaderMaterial yields scale = 0 and zero-pixel points. The
  // distance ramp replaces it, and doubles as the blur.
  // **Grow a sparse dot to cover the ground it stands for.** The scatter thins outward, and
  // density is brightness for a fixed-size sprite, so without this the field would have to be
  // three times as dense to avoid reading as a ring of sudden darkness just past the lattice.
  // sqrt, so pixel AREA scales with aSpread: density falls as 1/spread^2 and area rises as
  // spread, leaving 1/spread for the eye to integrate instead of 1/spread^2.
  float size = uSize * sqrt( aSpread ) * ( 1.0 + uFarGrow * far ) * ( 1.0 + 0.55 * tw );
  // the clamp guards ALIASED_POINT_SIZE_RANGE, which is as low as 63 on some mobile GL. Our
  // worst case is about 17.5 px at dpr 2, so it never engages; it is here so a future tweak
  // cannot silently produce invisible points.
  gl_PointSize = clamp( size * uPixelRatio, 1.0, 48.0 );

  #include <fog_vertex>
}
`;

const DOT_FRAGMENT = /* glsl */ `
uniform float uOpacity;
uniform float uSharpNear;
uniform float uSharpFar;

varying vec3  vTint;
varying float vAlpha;
varying float vSoft;

#include <common>
#include <fog_pars_fragment>
#include <tonemapping_pars_fragment>

void main() {
  // a soft gaussian instead of the default hard square, widening with distance. This is the
  // whole adaptive blur: a near dot is a tight point, a far dot is a big dim smudge, and the
  // transition between them is continuous.
  vec2  c  = gl_PointCoord - vec2( 0.5 );
  float r2 = dot( c, c ) * 4.0;                    // 0 at the centre, 1 at the sprite edge
  float g  = exp( -r2 * mix( uSharpNear, uSharpFar, vSoft ) );
  g *= smoothstep( 1.0, 0.75, r2 );                // cut the corners so the quad never shows

  float a = g * vAlpha * uOpacity;
  if ( a < 0.004 ) discard;                        // the far field is most of the fill rate

  gl_FragColor = vec4( vTint, a );

  ${FOG_CHUNK}

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const WIRE_VERTEX = /* glsl */ `
attribute vec3 aTint;

varying vec3  vTint;
varying float vAlpha;

#include <common>
#include <fog_pars_vertex>
${FADE_CHUNK}

void main() {
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;

  vec3  worldPos = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
  float d        = groundDistance( worldPos );
  float far      = smoothstep( uFadeStart, uFadeEnd, d );

  // no twinkle on the lattice: twinkling lines read as noise rather than as atmosphere, and the
  // lattice is the layer that has to stay legible as a survey grid
  vTint  = aTint;
  vAlpha = ( 1.0 - far ) * grazeFade( worldPos );

  #include <fog_vertex>
}
`;

const WIRE_FRAGMENT = /* glsl */ `
uniform float uOpacity;

varying vec3  vTint;
varying float vAlpha;

#include <common>
#include <fog_pars_fragment>
#include <tonemapping_pars_fragment>

void main() {
  float a = vAlpha * uOpacity;
  if ( a < 0.004 ) discard;

  gl_FragColor = vec4( vTint, a );

  ${FOG_CHUNK}

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface TerrainMeshProps {
  terrain: Terrain;
  /** the circuit's own bounding-box extent, which sets how far the lattice reaches. */
  extent: number;
  exaggeration: number;
  reducedMotion: boolean;
}

export function TerrainMesh({ terrain, extent, exaggeration, reducedMotion }: TerrainMeshProps) {
  const tokens = useThemeTokens();

  const rampColor = useMemo(() => {
    const lo: [number, number, number] = [0, 0, 0];
    const mid: [number, number, number] = [0, 0, 0];
    const hi: [number, number, number] = [0, 0, 0];
    hexToLinearRgb(tokens.terrainLo, lo);
    hexToLinearRgb(tokens.terrainMid, mid);
    hexToLinearRgb(tokens.terrainHi, hi);
    return (t: number, out: [number, number, number]) => {
      const c = Math.min(Math.max(t, 0), 1);
      const [a, b, f] = c < 0.6 ? [lo, mid, c / 0.6] : [mid, hi, (c - 0.6) / 0.4];
      out[0] = a[0] + f * (b[0] - a[0]);
      out[1] = a[1] + f * (b[1] - a[1]);
      out[2] = a[2] + f * (b[2] - a[2]);
    };
  }, [tokens]);

  const radii = useMemo(() => fieldRadii(terrain, extent), [terrain, extent]);

  const anchor = useMemo(() => {
    // the heightfield's centre. **The fade is anchored to the scene, not to the camera.** A
    // camera-anchored fade is a pool of light that swims with you, which is the most obvious
    // "this is a shader" tell there is, and it breaks outright at the overview: a radius large
    // enough to fill the frame from 5 km out also reaches the geometry edge behind you.
    //
    // The scene anchor is safe *because* CameraRig's OrbitControls caps maxDistance at
    // extent*2.5, about 5.1 km, which is inside fadeEnd at 5.2 km. Raising that cap breaks this
    // fade from a file that says nothing about terrain; there is a matching note over there.
    const width = (terrain.nCells - 1) * terrain.dx;
    const depth = (terrain.nCells - 1) * terrain.dz;
    return new THREE.Vector3(terrain.x0 + width / 2, 0, terrain.z0 + depth / 2);
  }, [terrain]);

  const layout = useMemo(
    () =>
      buildFieldLayout({
        centerX: anchor.x,
        centerZ: anchor.z,
        latticeRadiusM: radii.latticeRadius,
        wireRadiusM: radii.wireRadius,
        outerRadiusM: radii.outerRadius,
      }),
    [anchor, radii],
  );

  const { surface, wire, dots } = useMemo(() => {
    const n = terrain.nCells;
    const R = SKIRT_RINGS;
    const N = n + 2 * R;

    const xs = buildGridAxis(terrain.x0, n, terrain.dx);
    const zs = buildGridAxis(terrain.z0, n, terrain.dz);

    let hMin = Infinity;
    let hMax = -Infinity;
    let hSum = 0;
    for (let i = 0; i < terrain.heights.length; i++) {
      const h = terrain.heights[i];
      hMin = Math.min(hMin, h);
      hMax = Math.max(hMax, h);
      hSum += h;
    }
    const hMean = hSum / terrain.heights.length;
    const hSpan = Math.max(hMax - hMin, 1e-9);
    const glow = tokens.terrainGlow;
    const rgb: [number, number, number] = [0, 0, 0];

    // --- the occluder plate: the original rectangular grid, unchanged --------------------------
    // It is sceneBg-coloured and fogged to sceneFog, so its rectangle was never what showed. Its
    // geometry also backs the road clearance guarantee, so it stays exactly as it was.
    const platePos = new Float32Array(N * N * 3);
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const v = iz * N + ix;
        platePos[3 * v] = xs[ix];
        platePos[3 * v + 1] = plateVertexHeight(terrain, hMean, ix, iz).h - DROP_BELOW_ROAD;
        platePos[3 * v + 2] = zs[iz];
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(platePos, 3));
    const triangles: number[] = [];
    for (let iz = 0; iz < N - 1; iz++) {
      for (let ix = 0; ix < N - 1; ix++) {
        const a = iz * N + ix;
        // wound for +Y normals, and the anti-diagonal split plateHeightAt reproduces
        triangles.push(a, a + N, a + 1, a + 1, a + N, a + N + 1);
      }
    }
    geo.setIndex(triangles);
    // no normals: the occluder is a MeshBasicMaterial and never shades. It also cannot pick up
    // scene.environment, which three only applies to standard/physical materials.

    // --- the visible field: circular lattice, dissolving into scatter --------------------------
    const positions = new Float32Array(layout.count * 3);
    const tints = new Float32Array(layout.count * 3);
    const phases = new Float32Array(layout.count);

    for (let i = 0; i < layout.count; i++) {
      const x = layout.xz[2 * i];
      const z = layout.xz[2 * i + 1];
      // sampled off the *plate*, so every dot sits on the surface that occludes it rather than
      // sinking beneath it out in the skirt. See plateHeightAt.
      const { h, sampled } = plateHeightAt(terrain, xs, zs, hMean, x, z);

      positions[3 * i] = x;
      positions[3 * i + 1] = h - DROP_BELOW_ROAD;
      positions[3 * i + 2] = z;

      // tinted by the *raw* terrain, not the relaxed skirt: relaxing the colour too would wash
      // the whole far field to one mid-ramp value
      rampColor((sampled - hMin) / hSpan, rgb);
      tints[3 * i] = Math.min(rgb[0] * glow, 1);
      tints[3 * i + 1] = Math.min(rgb[1] * glow, 1);
      tints[3 * i + 2] = Math.min(rgb[2] * glow, 1);

      // deterministic per-point phase, so the field shimmers identically on every load and in
      // every screenshot, which is what makes two captures comparable
      phases[i] = ((i * 2654435761) >>> 20) / 4096;
    }

    const positionAttr = new THREE.Float32BufferAttribute(positions, 3);
    // named aTint rather than `color` on purpose: three's vertex prefix declares `color` behind
    // USE_COLOR, so a ShaderMaterial that declares it too is a duplicate-declaration compile
    // error, and one that does not is an unbound attribute. A custom name sidesteps the define.
    const tintAttr = new THREE.Float32BufferAttribute(tints, 3);

    // the wireframe shares the field's position and tint buffers and carries only its own index.
    // It covers the inner part of the lattice only, and its fade reaches zero inside that, so its
    // circular boundary is never a visible edge. Three segments per cell, matching the plate's
    // triangulation: two would read as a different lattice from the surface underneath.
    const segments: number[] = [];
    const cols = layout.latticeCols;
    const wireR2 = layout.wireRadiusM * layout.wireRadiusM;
    const inWire = (idx: number) => {
      const dx = positions[3 * idx] - anchor.x;
      const dz = positions[3 * idx + 2] - anchor.z;
      return dx * dx + dz * dz <= wireR2;
    };
    const link = (a: number, b: number) => {
      if (a >= 0 && b >= 0 && inWire(a) && inWire(b)) segments.push(a, b);
    };
    const K = WIRE_STRIDE;
    for (let j = 0; j + K < cols; j += K) {
      for (let i = 0; i + K < cols; i += K) {
        const v = layout.latticeAt[j * cols + i];
        const right = layout.latticeAt[j * cols + i + K];
        const down = layout.latticeAt[(j + K) * cols + i];
        if (v >= 0) {
          link(v, right);
          link(v, down);
        }
        // the diagonal, matching the plate's anti-diagonal split: two segments per cell would
        // read as a different lattice from the surface underneath it
        link(right, down);
      }
    }
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute("position", positionAttr);
    wireGeo.setAttribute("aTint", tintAttr);
    wireGeo.setIndex(segments);

    // the dots need their own geometry with **no index**: an indexed one would draw a point per
    // index, so every vertex would be overdrawn once per edge that touches it
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute("position", positionAttr);
    dotGeo.setAttribute("aTint", tintAttr);
    dotGeo.setAttribute("aPhase", new THREE.Float32BufferAttribute(phases, 1));
    dotGeo.setAttribute("aSpread", new THREE.Float32BufferAttribute(layout.spread, 1));

    return { surface: geo, wire: wireGeo, dots: dotGeo };
  }, [terrain, layout, anchor, rampColor, tokens.terrainGlow]);

  const { dotMaterial, wireMaterial, occluderMaterial } = useMemo(() => {
    const shared = () => ({ uAnchor: { value: anchor } });

    const dot = new THREE.ShaderMaterial({
      vertexShader: DOT_VERTEX,
      fragmentShader: DOT_FRAGMENT,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          ...shared(),
          uTime: { value: 0 },
          uMotion: { value: reducedMotion ? 0 : 1 },
          uFadeStart: { value: radii.fadeStart },
          uFadeEnd: { value: radii.fadeEnd },
          // these used to fork on the theme, and the dark half of the fork was a star field:
          // brighter, larger, twinklier dots blended additively onto a night sky. Both renditions
          // are printed sheets now, so there is one set of values and it is the printed one. A
          // page does not twinkle, but 0 is worse: at zero the field reads as a static screen
          // rather than as stippling, so the shimmer stays, faint.
          uTwinkle: { value: 0.12 },
          uSize: { value: 2.0 },
          uFarGrow: { value: 1.4 },
          uSharpNear: { value: 3.6 },
          uSharpFar: { value: 1.6 },
          uOpacity: { value: 0.6 },
          uPixelRatio: { value: 1 },
        },
      ]),
      // ShaderMaterial defaults fog to false and does not populate the fog uniforms; both halves
      // are needed or the USE_FOG define arrives with nothing behind it
      fog: true,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NormalBlending,
    });
    // UniformsUtils.merge deep-clones, so the anchor has to be put back by identity or the
    // material animates around a copy
    dot.uniforms.uAnchor.value = anchor;

    const wireMat = new THREE.ShaderMaterial({
      vertexShader: WIRE_VERTEX,
      fragmentShader: WIRE_FRAGMENT,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          ...shared(),
          uFadeStart: { value: radii.wireFadeStart },
          uFadeEnd: { value: radii.wireFadeEnd },
          uOpacity: { value: 0.32 },
        },
      ]),
      fog: true,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NormalBlending,
    });
    wireMat.uniforms.uAnchor.value = anchor;

    // A flat plate, and deliberately *only* a flat plate.
    //
    // It first carried its own radial convergence toward the horizon colour, on the same radii
    // as the dot fade, so the grid's far edge would be the same colour as the sky rather than
    // merely hazed over it. That was redundant and wrong in principle: fogExp2 already carries
    // the plate to exactly tokens.sceneFog, and fog is anchored to the **camera** while the
    // radial term was anchored to the **scene**, so the two disagreed at every camera position
    // and the plate lightened with distance from the circuit rather than from the viewer.
    //
    // The boundary guarantee does not need it. The skirt puts the edge 5 km past the
    // heightfield, and OrbitControls caps the camera at 5.1 km from the target, so the nearest
    // the edge can ever be seen from is about 6 km: 96% fog, with the dot and wire fades
    // already at zero well inside that.
    const occluder = new THREE.MeshBasicMaterial({
      color: tokens.sceneBg,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    return { dotMaterial: dot, wireMaterial: wireMat, occluderMaterial: occluder };
    // reducedMotion seeds uMotion here and is driven by the effect below, so it is not a dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, radii, tokens.sceneBg, tokens.sceneFog]);

  useEffect(
    () => () => {
      dotMaterial.dispose();
      wireMaterial.dispose();
      occluderMaterial.dispose();
    },
    [dotMaterial, wireMaterial, occluderMaterial],
  );

  useEffect(
    () => () => {
      surface.dispose();
      wire.dispose();
      dots.dispose();
    },
    [surface, wire, dots],
  );

  // live: the OS preference can flip mid-session, and the side panel's override can flip any
  // time, so this must not be baked in at construction
  useEffect(() => {
    dotMaterial.uniforms.uMotion.value = reducedMotion ? 0 : 1;
  }, [dotMaterial, reducedMotion]);

  const clock = useRef(0);
  useFrame(({ gl }, dt) => {
    dotMaterial.uniforms.uPixelRatio.value = gl.getPixelRatio();
    if (reducedMotion) return; // uTime stays at 0: a static, correctly faded field
    clock.current += dt;
    // the dots only. The wire has no time-varying term at all since the sweep was removed, so
    // advancing its clock would be an upload a frame that changes nothing on screen.
    dotMaterial.uniforms.uTime.value = clock.current;
  });

  const scale: [number, number, number] = [1, exaggeration, 1];

  return (
    <group>
      <mesh geometry={surface} scale={scale} material={occluderMaterial} />
      <lineSegments geometry={wire} scale={scale} material={wireMaterial} />
      <points geometry={dots} scale={scale} material={dotMaterial} />
    </group>
  );
}
