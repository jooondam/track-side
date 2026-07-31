// the M5 glTF ribbon. The asphalt tone comes from the theme rather than a literal, so the road
// stays separated from the background in both themes: it has to be lighter than a dark
// background and darker than a light one, which one hardcoded grey cannot do.

import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useThemeTokens } from "../ui/theme";

export function TrackMesh({ url }: { url: string }) {
  const gltf = useGLTF(url);
  const tokens = useThemeTokens();

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: tokens.asphalt,
        roughness: 0.94,
        metalness: 0.0,
        side: THREE.DoubleSide,
      }),
    [tokens],
  );

  useEffect(() => {
    gltf.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.material = material;
    });
    return () => material.dispose();
  }, [gltf, material]);

  return <primitive object={gltf.scene} />;
}
