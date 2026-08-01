// the glTF surface set. Since M9 the GLB carries three primitives (asphalt and the two aprons)
// with their own material slots and a TEXCOORD_0 of (lateral_frac, s_m in metres), so this maps
// slot names to generated materials rather than overwriting one material onto everything.
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
import { asphaltRoughness, gravelColor, grassRoughness } from "./textures";

/** material slot names, matching offline/mesh/surfaces.py's SURFACE_MATERIALS order. */
const ASPHALT = "asphalt";

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
      roughnessMap: asphaltRoughness(),
      side: THREE.DoubleSide,
    });
    // the apron is four times the road's width once both sides are counted, so its tone decides
    // what the overview shot reads as. Too dark and it is a black band; pure white and it swamps
    // the asphalt it is supposed to frame. A muted olive keeps it continuous with the terrain and
    // lets the road stay the darkest, most legible thing on screen.
    const apron = new THREE.MeshStandardMaterial({
      color: "#93937c",
      roughness: 0.99,
      metalness: 0,
      roughnessMap: grassRoughness(),
      map: gravelColor(),
      side: THREE.DoubleSide,
    });
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
