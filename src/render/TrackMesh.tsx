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
        // lifted out of near-black so the road separates from the #0a0a0f background at
        // distance -- the original #2a2a30 vanished once the camera pulled back
        obj.material = new THREE.MeshStandardMaterial({
          color: "#3a3a42",
          roughness: 0.95,
          metalness: 0.0,
          side: THREE.DoubleSide,
        });
      }
    });
  }, [gltf]);

  return <primitive object={gltf.scene} />;
}
