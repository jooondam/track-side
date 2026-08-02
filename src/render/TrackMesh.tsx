// the glTF surface set. Since M9 the GLB carries three primitives (asphalt and the two aprons)
// with their own material slots and a TEXCOORD_0 of (lateral_frac, s_m in metres), so this maps
// slot names to generated materials rather than overwriting one material onto everything.
//
// Tones come from the theme rather than from literals: the road has to be lighter than a dark
// background and darker than a light one, which one hardcoded grey cannot do.
//
// **The apron is banded in the fragment shader, and that is what makes the road look 12 m wide.**
// The GLB gives each apron four columns at 0, 0.4, 12 and 32 lateral metres: the boundary, the
// raised lip the kerbs stand on, the run-off edge and the tie to terrain. It used to be painted
// one flat olive with two textures whose repeats were wrong by two orders of magnitude, so 64 m
// of apron rendered as a featureless slab continuous with the asphalt and the whole surface read
// as one 76 m road. Nothing here needs the asset regenerated: the geometry was always right, and
// the zones are drawn from the lateral coordinate the mesh already carries.
//
// Two GPU bugs fixed here, both of which were masked only because switching circuits used to
// unmount the whole canvas:
//
//   1. the cleanup disposed the material but not its textures, so every circuit switch leaked
//      the maps. Textures are owned by src/render/textures.ts now and released together.
//   2. useGLTF caches the parsed GLTF, so gltf.scene is *shared* across every mount. Mutating
//      obj.material on it and then disposing that material on unmount left the cached scene
//      pointing at a disposed material, and the next mount rendered black. The scene is cloned
//      per mount so the cache stays pristine.

import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useThemeTokens } from "../ui/theme";
import { apronGrain, asphaltRoughness } from "./textures";

/** material slot names, matching offline/mesh/surfaces.py's SURFACE_MATERIALS order. */
const ASPHALT = "asphalt";

// zone boundaries in lateral metres, from offline/mesh/surfaces.py. The blend widths are
// deliberately asymmetric: the concrete lip is only 0.4 m wide, so a wide blend would eat it
// whole, while the run-off to grass edge is a soft natural one. The grass blend is centred on
// the 12 m column so the colour change and the geometry's height change land together instead
// of reading as two separate edges a couple of metres apart.
const LIP_BLEND = "0.25, 0.60";
const GRASS_BLEND = "10.75, 13.25";
/** how far the asphalt's shadow reaches out over the apron, in metres. */
const CONTACT_M = "1.2";

export function TrackMesh({ url }: { url: string }) {
  const gltf = useGLTF(url);
  const tokens = useThemeTokens();

  // never mutate the cached scene: clone it per mount (see note 2 above)
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);

  const materials = useMemo(() => {
    const asphalt = new THREE.MeshStandardMaterial({
      color: tokens.asphalt,
      roughness: 0.94,
      metalness: 0,
      // the asphalt's UV is (lateral_frac 0..1, s_m), so this texture's [3, 1/8] repeat is
      // correct as authored and must not be touched: three across the road, once every 8 m
      // along it. Only the apron's UV is in metres on both axes.
      roughnessMap: asphaltRoughness(),
      side: THREE.DoubleSide,
    });

    const apron = new THREE.MeshStandardMaterial({
      // no `color`: white is the identity for the shader's diffuseColor.rgb *= apron.
      // no `map`: the zone blend samples uGrain directly, so USE_MAP is never defined and
      //           vMapUv never exists -- which is why the varying below reads the raw uv.
      // no `roughnessMap`: <roughnessmap_fragment> is replaced wholesale, so this material
      //           owns roughnessFactor itself.
      roughness: 0.99,
      metalness: 0,
      side: THREE.DoubleSide,
    });

    apron.onBeforeCompile = (shader) => {
      shader.uniforms.uGrain = { value: apronGrain() };
      shader.uniforms.uLip = { value: new THREE.Color(tokens.apronLip) };
      shader.uniforms.uGravel = { value: new THREE.Color(tokens.apronGravel) };
      shader.uniforms.uGrass = { value: new THREE.Color(tokens.apronGrass) };

      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vApronUv;")
        // the RAW uv attribute, not vMapUv. vMapUv is (mapTransform * uv), so it carries the
        // map's repeat and offset baked in and only equals the lateral metres when the repeat
        // is (1,1); worse, it is declared behind USE_MAP, and this material has no map at all.
        // three's vertex prefix declares `attribute vec2 uv` unconditionally, so this has no
        // such coupling.
        .replace("#include <uv_vertex>", "#include <uv_vertex>\nvApronUv = uv;");

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
           uniform sampler2D uGrain;
           uniform vec3 uLip;
           uniform vec3 uGravel;
           uniform vec3 uGrass;
           varying vec2 vApronUv;`,
        )
        .replace(
          "#include <map_fragment>",
          `// vApronUv is ( lateral offset in METRES 0..32, arc length s in METRES ). Every band
           // below is drawn here rather than modelled: the GLB carries only four columns across
           // each apron, so none of this needs the asset rebuilt.
           float lat = vApronUv.x;
           vec2  sxy = vec2( vApronUv.y, vApronUv.x );  // (along, across), so grain runs with the road

           float wLip    = 1.0 - smoothstep( ${LIP_BLEND}, lat );
           float wGrass  =       smoothstep( ${GRASS_BLEND}, lat );
           float wGravel = clamp( 1.0 - wLip - wGrass, 0.0, 1.0 );

           float gLip    = texture2D( uGrain, sxy /  0.6 ).r;
           float gGravel = texture2D( uGrain, sxy /  3.0 ).r;
           float gGrass  = texture2D( uGrain, sxy /  4.0 ).g;
           float gBlotch = texture2D( uGrain, sxy / 18.0 ).b;

           vec3 cLip    = uLip    * ( 0.90 + 0.20 * gLip );
           vec3 cGravel = uGravel * ( 0.78 + 0.44 * gGravel );
           vec3 cGrass  = uGrass  * ( 0.72 + 0.36 * gGrass ) * ( 0.85 + 0.30 * gBlotch );

           vec3 apron = cLip * wLip + cGravel * wGravel + cGrass * wGrass;

           // a contact darkening where the apron meets the asphalt. This is what makes the
           // road's edge read as an EDGE rather than as a change of colour, and it is most of
           // why 12 m of asphalt used to look like the middle of a much wider slab.
           apron *= mix( 0.55, 1.0, smoothstep( 0.0, ${CONTACT_M}, lat ) );

           diffuseColor.rgb *= apron;`,
        )
        .replace(
          "#include <roughnessmap_fragment>",
          `// gravel and grass are matte; the concrete lip is the only part of the apron with
           // any sheen. Replacing the chunk means owning roughnessFactor outright.
           float roughGrain = mix( gGravel, gGrass, wGrass );
           float roughnessFactor = mix( 0.99, 0.86, wLip ) - 0.06 * roughGrain;`,
        );
    };

    // both aprons share one material: they are the same surface on opposite sides, and one
    // material is one fewer draw call
    return { [ASPHALT]: asphalt, apron_left: apron, apron_right: apron } as Record<
      string,
      THREE.MeshStandardMaterial
    >;
  }, [tokens]);

  useEffect(() => {
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      // the GLB names each primitive in extras; fall back to asphalt for anything unnamed so a
      // future primitive renders as road rather than as nothing
      const slot = (obj.material as THREE.Material | undefined)?.name || ASPHALT;
      obj.material = materials[slot] ?? materials[ASPHALT];
    });
    return () => {
      // dispose each distinct material once; the shared textures are owned by textures.ts
      for (const material of new Set(Object.values(materials))) material.dispose();
    };
  }, [scene, materials]);

  return <primitive object={scene} />;
}
