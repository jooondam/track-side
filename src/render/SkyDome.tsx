// the sky, as one gradient shader driven entirely by theme tokens.
//
// This replaces drei's <Sky>, which is three-stdlib's Preetham model. Preetham is a *daylight*
// model: it has no night mode, and no combination of turbidity and rayleigh dims it. The dark
// theme was rendering a bright hazy dusk sky washed to near-white by ACES, so "dark mode" meant
// a black ground meeting a white sky, which is the opposite of the point. Both themes now run
// the same shader and differ only in colour, so the two can be reasoned about together.
//
// Three properties make this work where a flat clear colour would not:
//
//   1. **toneMapped is off.** With it on, ACES would pull a near-black zenith back up toward
//      grey. Off, `skyZenith: "#05070f"` is literally the pixel value at the top of the frame.
//      That exactness is the whole answer to "dark mode has a white background".
//   2. **The horizon band is tokens.sceneFog**, the same value the scene's fogExp2 uses and the
//      same value the terrain occluder converges to at its far edge. The terrain's rectangular
//      boundary is therefore not merely hazed over, it is the same colour as what is behind it.
//   3. **The dome is camera-anchored.** drei's <Sky> box sat at the world origin with a half
//      edge of extent*3, while OrbitControls lets the camera reach extent*2.5 from centre; a
//      free-look pan could leave the box and expose the raw clear colour. Anchoring to the
//      camera makes that geometrically impossible.

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useThemeTokens } from "../ui/theme";

const VERTEX = /* glsl */ `
varying vec3 vDir;

void main() {
  // the dome is translated (camera-anchored) and uniformly scaled, nothing else, so the
  // unit-sphere position is already the world direction. No normal matrix needed.
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3  uZenith;
uniform vec3  uHorizon;
uniform vec3  uSunColor;
uniform vec3  uSunDir;
uniform float uSunIntensity;
uniform float uHorizonSharp;
uniform float uStars;
uniform float uTime;
uniform float uMotion;

varying vec3 vDir;

#include <common>
#include <tonemapping_pars_fragment>

float hash13( vec3 p ) {
  p  = fract( p * 0.1031 );
  p += dot( p, p.yzx + 33.33 );
  return fract( ( p.x + p.y ) * p.z );
}

void main() {
  vec3  dir = normalize( vDir );
  float h   = dir.y;

  // vertical gradient. The pow exponent is below 1, which compresses the ramp toward the
  // horizon so most of the dome sits at zenith colour and all the variation lives in the last
  // few degrees. A linear mix puts the midtone at 45 degrees of elevation, which reads as a
  // painted backdrop rather than as air.
  float up  = clamp( h, 0.0, 1.0 );
  vec3  col = mix( uHorizon, uZenith, pow( up, uHorizonSharp ) );

  // Below the horizon the sky stays flat at uHorizon, with no darkening of any kind.
  //
  // It used to fall off toward a separate, darker skyGround token, and that token was the one
  // thing in the scene that could not agree with the fog. The terrain plate is finite, so at a
  // zoomed-out camera its far edge sits *below* the true horizon; the plate arrives there at
  // 100% fog, which is exactly tokens.sceneFog, while the sky just above it had already started
  // sliding toward skyGround. The mismatch drew the plate's whole silhouette as a visible
  // trapezoid hanging in the sky. Anything below the horizon that is not terrain is simply haze
  // at the fog colour, so that is what it is, and the edge is now unfindable by construction.
  float down = clamp( -h, 0.0, 1.0 );
  col = mix( col, uHorizon, smoothstep( 0.0, 0.18, down ) );

  // the sun as a glow, not a body: no disc, no limb darkening, nothing to alias. Two lobes,
  // because a single exponent cannot be both a tight core and a wide atmospheric bloom.
  vec3  sunDir = normalize( uSunDir );
  float mu     = max( dot( dir, sunDir ), 0.0 );
  float broad  = pow( mu,   5.0 );
  float tight  = pow( mu, 220.0 );
  float above  = smoothstep( -0.10, 0.08, h );  // never light the ground half
  col += uSunColor * uSunIntensity * above * ( 0.45 * broad + 2.2 * tight );

  if ( uStars > 0.0 ) {
    vec3  cellPos = dir * 260.0;
    float r       = hash13( floor( cellPos ) );
    float pick    = step( 0.9993, r );                 // roughly 700 stars over the dome
    vec3  local   = fract( cellPos ) - 0.5;
    // 12.0, not 34.0: a tighter core is sub-pixel at this field of view and crawls as the
    // camera rotates. About two pixels across is the smallest a star can be and stay still.
    float spark = pick * exp( -dot( local, local ) * 12.0 );
    float tw    = 1.0 - uMotion * 0.35 * ( 0.5 + 0.5 * sin( uTime * 0.9 + r * 41.0 ) );
    // gated twice: nothing below about 16 degrees of elevation, nothing inside the sun's glow.
    // The racing line is the one thing in this scene allowed to compete for attention.
    float mask  = smoothstep( 0.03, 0.28, h ) * ( 1.0 - broad );
    col += vec3( spark * tw * mask * uStars );
  }

  // one LSB of hash noise. A near-black gradient stretched over a thousand-odd pixels bands
  // hard on an 8-bit framebuffer, and 0.2b rules out a postprocessing pass to dither it in.
  col += vec3( ( hash13( vec3( gl_FragCoord.xy, 0.0 ) ) - 0.5 ) / 255.0 );

  gl_FragColor = vec4( col, 1.0 );

  // both includes are mandatory and neither is added for us on a ShaderMaterial. With
  // toneMapped false the first compiles to nothing, which is the point; omitting the second
  // renders the whole sky in raw linear, uniformly too dark, with no error anywhere.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface SkyDomeProps {
  sun: readonly [number, number, number];
  extent: number;
  reducedMotion: boolean;
}

export function SkyDome({ sun, extent, reducedMotion }: SkyDomeProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const clock = useRef(0);
  const tokens = useThemeTokens();

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          uZenith: { value: new THREE.Color(tokens.skyZenith) },
          uHorizon: { value: new THREE.Color(tokens.sceneFog) },
          uSunColor: { value: new THREE.Color(tokens.skySun) },
          uSunDir: { value: new THREE.Vector3(sun[0], sun[1], sun[2]) },
          uSunIntensity: { value: tokens.skySunIntensity },
          uHorizonSharp: { value: tokens.skyHorizonSharp },
          uStars: { value: tokens.skyStars },
          uTime: { value: 0 },
          uMotion: { value: reducedMotion ? 0 : 1 },
        },
        side: THREE.BackSide,
        // all four matter. depthTest off makes the dome a pure background, so its radius stops
        // being load-bearing; leave it on and the radius has to be re-argued every time the
        // camera bounds change.
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
    // sun and reducedMotion are seeded here but driven by the effects below, so they are not
    // deps: rebuilding the material on a theme toggle is fine, rebuilding it on a media query
    // flip would drop a frame for no reason
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tokens],
  );

  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    material.uniforms.uSunDir.value.set(sun[0], sun[1], sun[2]);
  }, [material, sun]);

  // usePrefersReducedMotion is a live matchMedia listener, so this can flip mid-session and
  // must not be baked in at material construction
  useEffect(() => {
    material.uniforms.uMotion.value = reducedMotion ? 0 : 1;
  }, [material, reducedMotion]);

  useFrame(({ camera }, dt) => {
    meshRef.current?.position.copy(camera.position);
    if (reducedMotion) return;
    clock.current += dt;
    material.uniforms.uTime.value = clock.current;
  });

  return (
    <mesh
      ref={meshRef}
      scale={extent * 2}
      // the dome is drawn first and never culled: a camera-anchored mesh can otherwise be
      // culled on the frame the camera jumps, against a bounding sphere from its old position
      renderOrder={-1000}
      frustumCulled={false}
      material={material}
    >
      <sphereGeometry args={[1, 64, 32]} />
    </mesh>
  );
}
