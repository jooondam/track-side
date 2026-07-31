// the M5 glTF ribbon, matte dark grey for the dark-telemetry look -- the track is context,
// the data on top of it is the subject.

import { useGLTF } from "@react-three/drei";
import { useEffect } from "react";
import * as THREE from "three";

export function TrackMesh({ url }: { url: string }) {
  const gltf = useGLTF(url);

  useEffect(() => {
    gltf.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.material = new THREE.MeshStandardMaterial({
          color: "#2a2a30",
          roughness: 0.9,
          metalness: 0.0,
          side: THREE.DoubleSide,
        });
      }
    });
  }, [gltf]);

  return <primitive object={gltf.scene} />;
}
