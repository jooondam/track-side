// landscape context as a glowing point-and-wire field that recedes to nothing.
//
// Three layers, all sharing one position buffer so the whole landscape is three draw calls and
// one copy of the geometry:
//
//   1. a solid surface, coloured close to the background. It is there to *occlude*, not to be
//      seen: without it the circuit reads through its own hills and the far side of the lap
//      hangs in front of the near side.
//   2. the triangulated wireframe, indexed off the same positions, dim.
//   3. a point at every grid vertex, bright, coloured by elevation.
//
// The heightfield is 200 cells across, which at Spa is a 2159 x 3468 m rectangle, and that
// rectangle used to be visible as a hard edge from any zoomed-out camera. Two things fix it and
// both are needed:
//
//   - **a geometric skirt.** The grid no longer matches the heightfield. It carries 24 extra
//     rings on each side whose spacing grows geometrically out to 5 km, with heights
//     edge-clamped and relaxed toward the mean. Fading alone could not work: fade the field out
//     before its boundary and the whole thing vanishes at the overview instead.
//   - **a radial fade with an in-material blur.** Past FADE_START the dots grow, dim and soften
//     until they are gone; the wireframe goes first, so the field reads lattice, then dots, then
//     nothing. Growing a sprite while dropping its alpha spreads the same energy over more
//     pixels, which is a blur, done with no render target and no postprocessing pass (0.2b).
//
// And a guarantee underneath both, which lives in two other files: fogExp2 carries everything
// at that range to exactly tokens.sceneFog, and SkyDome paints its entire below-horizon half
// with the same token. So the plate's far edge and the sky it ends against are the same colour
// by construction, and the silhouette cannot be found from any camera position the leash in
// CameraRig allows -- which is what makes that leash part of this feature rather than a control
// preference.
//
// The grid maths lives in ./terrainGrid so it can be tested without r3f or a GPU.

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Terrain } from "../assets";
import { useTheme, useThemeTokens } from "../ui/theme";
import { hexToLinearRgb } from "./colorspace";
import { SKIRT_RINGS, buildGridAxis, fadeRadii, smoothstep01, terrainAnchorXz } from "./terrainGrid";

const DROP_BELOW_ROAD = 1.0; // sit under the ribbon so it never z-fights the apron


// shared shader preamble. The distance that drives everything is **horizontal**: the elevation
// exaggeration slider is a Y scale on this group, and a 3D distance would make the fade radius
// breathe every time the user dragged it.
const FADE_CHUNK = /* glsl */ `
uniform vec3  uAnchor;
uniform float uFadeStart;
uniform float uFadeEnd;
uniform float uTime;
uniform float uMotion;
uniform float uPulsePeriod;
uniform float uPulseWidth;
uniform float uPulseGain;

float groundDistance( vec3 worldPos ) {
  return length( worldPos.xz - uAnchor.xz );
}

// how edge-on the ground is from here, 0 at grazing and 1 looking straight down.
//
// Without this the field saturates into two blinding bars along the horizon whenever the camera
// drops near ground level: the dots are a fixed pixel size and do not attenuate, so as the
// ground plane foreshortens, more and more of them stack into the same pixel and an additive
// layer just adds until it clips. Dimming by the view angle is the physically right answer --
// a mat of points seen edge-on covers less solid angle per point, not more -- and it is what
// keeps the chase camera's horizon readable.
//
// It is deliberately *not* an altitude fade. The dot field this replaced faded out below 60 m
// of camera height, which left the chase shot with no ground at all; this dims only what is
// edge-on, so the ground directly under a low camera stays exactly as bright as before.
float grazeFade( vec3 worldPos ) {
  vec3  toEye = cameraPosition - worldPos;
  float len   = max( length( toEye ), 1e-4 );
  // the window is narrow on purpose. At 0.015..0.22 this also swallowed ground 100 m to the
  // side of a chase camera, which is the failure it was meant to prevent; the pile-up only
  // actually bites below about 0.05, so that is where it ends.
  return smoothstep( 0.003, 0.05, abs( toEye.y ) / len );
}

// one crest sweeping outward from the anchor every uPulsePeriod seconds. A 220 m gaussian over
// a 5.2 km reach lights about 4% of the field at any instant, which is the difference between
// ambience and a radar sweep.
float ringPulse( float d ) {
  float ringR = fract( uTime / uPulsePeriod ) * uFadeEnd;
  float arg   = ( d - ringR ) / uPulseWidth;
  return uMotion * uPulseGain * exp( -arg * arg );
}
`;

// three's <fog_fragment> does mix(rgb, fogColor, f). That is right for an opaque surface and
// wrong for an additive one: mixing a non-black fog colour into an additive sprite makes the
// distant field *brighter*, not hazier. An additive layer has to fade toward nothing, so under
// ADDITIVE_FOG the fog attenuates alpha instead of tinting rgb.
//
// This is coupled to the blending mode below. Flip the dark theme to NormalBlending without
// removing the define and distant dots go transparent instead of hazy.
const FOG_CHUNK = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( -fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  #ifdef ADDITIVE_FOG
    gl_FragColor.a *= ( 1.0 - fogFactor );
  #else
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  #endif
#endif
`;

const DOT_VERTEX = /* glsl */ `
uniform float uPixelRatio;
uniform float uSize;
uniform float uFarGrow;
uniform float uTwinkle;

attribute vec3  aTint;
attribute float aPhase;

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

  float pulse = ringPulse( d );
  // the hashed phase decorrelates neighbours, which is what stops this reading as a global
  // flicker. At 0.09 it sits below "something is animating" and above "this field is dead".
  float tw = uMotion * uTwinkle * sin( uTime * 0.6 + aPhase * 6.2831853 );

  vTint  = aTint * ( 1.0 + pulse + tw );
  vAlpha = ( 1.0 - far ) * mix( 1.0, 0.55, far ) * grazeFade( worldPos );

  // sizeAttenuation is deliberately absent and cannot be recovered here: three only maintains
  // the size and scale uniforms for material.isPointsMaterial, so defining
  // USE_SIZEATTENUATION on a ShaderMaterial yields scale = 0 and zero-pixel points. The
  // distance ramp replaces it, and doubles as the blur.
  float size = uSize * ( 1.0 + uFarGrow * far ) * ( 1.0 + 0.30 * pulse + 0.50 * tw );
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

  // no twinkle on the lattice: twinkling lines read as noise rather than as atmosphere
  vTint  = aTint * ( 1.0 + ringPulse( d ) );
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
  exaggeration: number;
  reducedMotion: boolean;
}

export function TerrainMesh({ terrain, exaggeration, reducedMotion }: TerrainMeshProps) {
  const tokens = useThemeTokens();
  const { theme } = useTheme();
  const dark = theme === "dark";

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

  const radii = useMemo(() => fadeRadii(terrain), [terrain]);

  const anchor = useMemo(() => {
    // the heightfield's centre. **The fade is anchored to the scene, not to the camera.** A
    // camera-anchored fade is a pool of light that swims with you, which is the most obvious
    // "this is a shader" tell there is, and it breaks outright at the overview: a radius large
    // enough to fill the frame from 5 km out also reaches the geometry edge behind you.
    //
    // The scene anchor is safe *because* CameraRig leashes the camera to this same point, at
    // cameraLeashM(extent), which is inside fadeEnd with a few hundred metres to spare. That
    // coupling is asserted in terrainGrid.test.ts, and it is the reason terrainAnchorXz is
    // imported rather than inlined here: the leash and the fade have to be measured from one
    // point, not from two that happen to agree today.
    const { x, z } = terrainAnchorXz(terrain);
    return new THREE.Vector3(x, 0, z);
  }, [terrain]);

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

    const positions = new Float32Array(N * N * 3);
    const tints = new Float32Array(N * N * 3);
    const phases = new Float32Array(N * N);
    const rgb: [number, number, number] = [0, 0, 0];
    const glow = tokens.terrainGlow;

    for (let iz = 0; iz < N; iz++) {
      // how deep into the skirt this row is: 0 in the core, rising to SKIRT_RINGS at the edge
      const ringZ = iz < R ? R - iz : iz >= R + n ? iz - (R + n - 1) : 0;
      const coreIz = Math.min(Math.max(iz - R, 0), n - 1);
      for (let ix = 0; ix < N; ix++) {
        const ringX = ix < R ? R - ix : ix >= R + n ? ix - (R + n - 1) : 0;
        const coreIx = Math.min(Math.max(ix - R, 0), n - 1);
        const v = iz * N + ix;

        // edge-clamped sample, relaxed toward the global mean across the ring. A pure clamp
        // extrudes Eau Rouge's relief straight out to 5 km and reads as a wall; a pure mean is
        // a table-flat plate meeting the real terrain at a crease. Smoothstepped, so neither
        // end of the ramp has a discontinuity.
        const relax = smoothstep01(Math.max(ringX, ringZ) / R);
        const sampled = terrain.heights[coreIz * n + coreIx];
        const h = sampled + relax * (hMean - sampled);

        positions[3 * v] = xs[ix];
        positions[3 * v + 1] = h - DROP_BELOW_ROAD;
        positions[3 * v + 2] = zs[iz];

        rampColor((sampled - hMin) / hSpan, rgb);
        tints[3 * v] = Math.min(rgb[0] * glow, 1);
        tints[3 * v + 1] = Math.min(rgb[1] * glow, 1);
        tints[3 * v + 2] = Math.min(rgb[2] * glow, 1);

        // deterministic per-vertex phase, same idiom as the tree-line jitter, so the field
        // twinkles identically on every load and in every screenshot
        phases[v] = ((v * 2654435761) >>> 20) / 4096;
      }
    }

    const positionAttr = new THREE.Float32BufferAttribute(positions, 3);
    const tintAttr = new THREE.Float32BufferAttribute(tints, 3);
    const phaseAttr = new THREE.Float32BufferAttribute(phases, 1);

    // named aTint rather than `color` on purpose: three's vertex prefix declares `color` behind
    // USE_COLOR, so a ShaderMaterial that declares it too is a duplicate-declaration compile
    // error, and one that does not is an unbound attribute. A custom name sidesteps the define.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", positionAttr);
    geo.setAttribute("aTint", tintAttr);
    const triangles: number[] = [];
    for (let iz = 0; iz < N - 1; iz++) {
      for (let ix = 0; ix < N - 1; ix++) {
        const a = iz * N + ix;
        // wound for +Y normals, which is also what puts the wire's diagonal on the same edge
        // the surface actually splits along
        triangles.push(a, a + N, a + 1, a + 1, a + N, a + N + 1);
      }
    }
    geo.setIndex(triangles);
    // no normals: the occluder is a MeshBasicMaterial and never shades. It also cannot pick up
    // scene.environment, which three only applies to standard/physical materials.

    // the wireframe shares the surface's position and tint buffers and carries only its own
    // index, so the triangulated look costs an index buffer rather than a second copy of 61k
    // vertices
    // One diagonal per cell, **everywhere**, matching the triangulation the surface uses.
    //
    // Drawing it only inside the heightfield looked like a free saving: nobody can resolve a
    // diagonal at 3 km. But the dots and lines are a fixed pixel size, so lattice density *is*
    // brightness, and three segments per cell inside against two outside is a 50% step along a
    // perfectly straight line. That redrew the heightfield's rectangle on screen as a lighter
    // plateau, which is the exact artefact the skirt exists to remove. 13% more segments is the
    // price of not having a visible boundary.
    const segments: number[] = [];
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const v = iz * N + ix;
        if (ix < N - 1) segments.push(v, v + 1);
        if (iz < N - 1) segments.push(v, v + N);
        if (ix < N - 1 && iz < N - 1) segments.push(v + 1, v + N);
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
    dotGeo.setAttribute("aPhase", phaseAttr);

    return { surface: geo, wire: wireGeo, dots: dotGeo };
  }, [terrain, rampColor, tokens.terrainGlow]);

  const { dotMaterial, wireMaterial, occluderMaterial } = useMemo(() => {
    const shared = () => ({
      uAnchor: { value: anchor },
      uTime: { value: 0 },
      uMotion: { value: reducedMotion ? 0 : 1 },
      uPulsePeriod: { value: 11.0 },
      uPulseWidth: { value: 220.0 },
    });

    const dot = new THREE.ShaderMaterial({
      vertexShader: DOT_VERTEX,
      fragmentShader: DOT_FRAGMENT,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          ...shared(),
          uFadeStart: { value: radii.fadeStart },
          uFadeEnd: { value: radii.fadeEnd },
          uPulseGain: { value: dark ? 0.28 : 0.16 },
          uTwinkle: { value: dark ? 0.09 : 0.05 },
          uSize: { value: dark ? 2.4 : 2.0 },
          uFarGrow: { value: dark ? 1.8 : 1.4 },
          uSharpNear: { value: dark ? 3.2 : 3.6 },
          uSharpFar: { value: dark ? 1.4 : 1.6 },
          uOpacity: { value: dark ? 0.95 : 0.6 },
          uPixelRatio: { value: 1 },
        },
      ]),
      // ShaderMaterial defaults fog to false and does not populate the fog uniforms; both halves
      // are needed or the USE_FOG define arrives with nothing behind it
      fog: true,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending,
      defines: dark ? { ADDITIVE_FOG: "" } : {},
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
          uPulseGain: { value: dark ? 0.18 : 0.1 },
          uOpacity: { value: dark ? 0.22 : 0.3 },
        },
      ]),
      fog: true,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending,
      defines: dark ? { ADDITIVE_FOG: "" } : {},
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
  }, [anchor, radii, dark, tokens.sceneBg, tokens.sceneFog]);

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

  // live matchMedia, so this can flip mid-session and must not be baked in at construction
  useEffect(() => {
    const motion = reducedMotion ? 0 : 1;
    dotMaterial.uniforms.uMotion.value = motion;
    wireMaterial.uniforms.uMotion.value = motion;
  }, [dotMaterial, wireMaterial, reducedMotion]);

  const clock = useRef(0);
  useFrame(({ gl }, dt) => {
    dotMaterial.uniforms.uPixelRatio.value = gl.getPixelRatio();
    if (reducedMotion) return; // uTime stays at 0: a static, correctly faded grid
    clock.current += dt;
    dotMaterial.uniforms.uTime.value = clock.current;
    wireMaterial.uniforms.uTime.value = clock.current;
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
