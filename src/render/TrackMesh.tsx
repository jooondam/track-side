// the glTF surface set. The GLB carries three primitives (asphalt and the two aprons) with their
// own material slots, and **only the asphalt is drawn**.
//
// The aprons used to be painted here: a three-zone fragment blend across the lateral coordinate,
// concrete lip to gravel to grass, with a contact-darkening ramp at the road edge. It solved a
// real problem (64 m of untextured apron made 12 m of asphalt read as one 76 m slab) and it
// solved it well, but it left the widest, loudest surface in the frame being the one carrying no
// information. The subject of this tool is the line on the road, so the road is now the only lit
// surface in the scene and the terrain field runs straight up to its edge.
//
// The apron geometry stays in the asset. It is generated and gated by offline/mesh/surfaces.py
// and offline/validation/checks.py, it costs nothing to skip a primitive at draw time, and
// keeping it means this is one component away from being reversible. What it costs is bytes in
// the GLB, which is worth revisiting in the asset pipeline rather than here.
//
// Tones come from the theme rather than from literals: the road has to be lighter than a dark
// background and darker than a light one, which one hardcoded grey cannot do.
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
import { asphaltRoughness } from "./textures";

/** material slot names, matching offline/mesh/surfaces.py's SURFACE_MATERIALS order. */
const ASPHALT = "asphalt";
const APRONS = new Set(["apron_left", "apron_right"]);

export function TrackMesh({ url }: { url: string }) {
  const gltf = useGLTF(url);
  const tokens = useThemeTokens();

  // never mutate the cached scene: clone it per mount (see note 2 above)
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);

  const asphalt = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: tokens.asphalt,
        roughness: 0.94,
        metalness: 0,
        // the asphalt's UV is (lateral_frac 0..1, s_m), so this texture's [3, 1/8] repeat is
        // correct as authored and must not be touched: three across the road, once every 8 m
        // along it.
        roughnessMap: asphaltRoughness(),
        side: THREE.DoubleSide,
      }),
    [tokens],
  );

  useEffect(() => {
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      // the GLB names each primitive in extras; anything unnamed renders as road rather than as
      // nothing, so a future primitive fails visible instead of silently missing
      const slot = (obj.material as THREE.Material | undefined)?.name || ASPHALT;
      if (APRONS.has(slot)) {
        obj.visible = false;
        return;
      }
      obj.material = asphalt;
    });
    return () => asphalt.dispose(); // the shared textures are owned by textures.ts
  }, [scene, asphalt]);

  return <primitive object={scene} />;
}
