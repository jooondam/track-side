// procedurally generated textures. No image files ship with this project at all.
//
// Two reasons beyond bundle size. Licensing: a downloaded asphalt photograph carries a licence
// and a provenance question, and DESIGN_NOTES section 5 keeps this project free of both. And
// determinism: every generator draws from a seeded mulberry32, so a circuit looks identical on
// every load and in every screenshot. A texture that reshuffles per session turns any visual
// comparison into noise.
//
// Everything here is memoised by key and never disposed by callers directly: dispose() on the
// module is the single owner, called when a circuit unmounts. Textures shared between materials
// were the other half of the GPU leak TrackMesh had, where disposing a material left its maps
// resident.

import * as THREE from "three";

/** small fast PRNG with a 32-bit state: same seed, same texture, forever. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<string, THREE.Texture>();

function memo(key: string, build: () => THREE.Texture): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const made = build();
  made.name = key;
  cache.set(key, made);
  return made;
}

/** release every generated texture. called when the last consumer unmounts. */
export function disposeTextures(): void {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
}

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const context = element.getContext("2d");
  if (!context) throw new Error("2d canvas context unavailable");
  return [element, context];
}

function finish(element: HTMLCanvasElement, repeat?: [number, number]): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(element);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  if (repeat) texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = 4;
  return texture;
}

/**
 * asphalt break-up, as a **roughness map only**.
 *
 * No normal map on purpose. The camera is rarely below 3 m and the surface is matte, so
 * varying roughness gives the whole "not moulded plastic" read at about half the GPU cost, and
 * it composes with the material's existing roughness rather than fighting it. A normal map here
 * would mostly be visible as shimmer at grazing angles.
 *
 * The UV is (lateral_frac in 0..1, s_m in metres), so repeat.set(3, 1/8) tiles three times
 * across the road and once every 8 m along it, whatever the road happens to be doing.
 */
export function asphaltRoughness(): THREE.Texture {
  return memo("asphaltRoughness", () => {
    const size = 512;
    const [element, context] = canvas(size, size);
    const image = context.createImageData(size, size);
    const data = image.data;
    const random = mulberry32(0x5eed_a5f4);

    // written straight into the buffer rather than as fillRect calls in a loop: 262,144 rects
    // is tens of milliseconds of canvas overhead for the same result
    for (let y = 0; y < size; y++) {
      // faint streaks along v, which is the direction of travel: the grain a road wears in
      const streak = 6 * Math.sin(y * 0.09) + 4 * Math.sin(y * 0.31 + 1.7);
      for (let x = 0; x < size; x++) {
        const speckle = random() * 46;
        const value = Math.max(0, Math.min(255, 150 + speckle + streak));
        const i = 4 * (y * size + x);
        data[i] = data[i + 1] = data[i + 2] = value;
        data[i + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    return finish(element, [3, 1 / 8]);
  });
}

/**
 * one red/white kerb period, so Kerbs.tsx can drop from two InstancedMesh to one.
 *
 * The alternation is a texture problem, not a geometry problem, which is also why kerbs are not
 * baked into the GLB: the stripe pitch stays a rendering decision.
 */
export function kerbStripe(): THREE.Texture {
  return memo("kerbStripe", () => {
    const [element, context] = canvas(64, 8);
    context.fillStyle = "#d8d8d8";
    context.fillRect(0, 0, 64, 8);
    context.fillStyle = "#c0392b";
    context.fillRect(0, 0, 32, 8);
    const texture = finish(element);
    texture.magFilter = THREE.NearestFilter; // keep the edge crisp, not smeared
    return texture;
  });
}

/** gravel trap colour: warm grey with coarse grain, tiled small. */
export function gravelColor(): THREE.Texture {
  return memo("gravelColor", () => {
    const size = 256;
    const [element, context] = canvas(size, size);
    const image = context.createImageData(size, size);
    const data = image.data;
    const random = mulberry32(0x9e37_79b9);

    for (let i = 0; i < size * size; i++) {
      const grain = random();
      const value = 138 + grain * 60;
      const o = 4 * i;
      data[o] = value;
      data[o + 1] = value * 0.96;
      data[o + 2] = value * 0.87;
      data[o + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return finish(element, [24, 24]);
  });
}

/** grass roughness break-up, coarser and higher contrast than asphalt. */
export function grassRoughness(): THREE.Texture {
  return memo("grassRoughness", () => {
    const size = 256;
    const [element, context] = canvas(size, size);
    const image = context.createImageData(size, size);
    const data = image.data;
    const random = mulberry32(0xc0ff_ee01);

    for (let i = 0; i < size * size; i++) {
      const value = 190 + random() * 65;
      const o = 4 * i;
      data[o] = data[o + 1] = data[o + 2] = value;
      data[o + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return finish(element, [40, 40]);
  });
}

/**
 * radial falloff for the car's blob shadow.
 *
 * A directional shadow map sized to a 4 km circuit is 2 m per texel at 2048, which renders the
 * car's shadow as a suggestion. One quad with this on it is exact where it matters, costs a
 * single draw, and nobody can tell the difference at any camera distance this scene uses.
 */
export function blobShadowAlpha(): THREE.Texture {
  return memo("blobShadowAlpha", () => {
    const size = 128;
    const [element, context] = canvas(size, size);
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(0,0,0,0.55)");
    gradient.addColorStop(0.55, "rgba(0,0,0,0.28)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(element);
    texture.name = "blobShadowAlpha";
    return texture;
  });
}

/** how many cells across and down the board atlas is laid out. */
export const BOARD_ATLAS_COLUMNS = 4;
export const BOARD_ATLAS_ROWS = 4;
/** the values a board panel can show, in atlas order. Distances first, then turn numbers. */
export const BOARD_ATLAS_FACES = [
  "300",
  "200",
  "100",
  "50",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "10",
  "11",
  "12",
  "14",
] as const;

/**
 * every numeral any board or turn sign needs, in one atlas, so the whole set is two draw calls.
 *
 * Licensing (DESIGN_NOTES section 5): braking distances and turn numbers are the only text
 * allowed anywhere in the scene. No sponsor boards, no circuit wordmarks. The atlas physically
 * cannot render anything else, because these sixteen faces are all there are.
 */
export function boardAtlas(): THREE.Texture {
  return memo("boardAtlas", () => {
    const cell = 128;
    const [element, context] = canvas(cell * BOARD_ATLAS_COLUMNS, cell * BOARD_ATLAS_ROWS);

    BOARD_ATLAS_FACES.forEach((face, index) => {
      const column = index % BOARD_ATLAS_COLUMNS;
      const row = Math.floor(index / BOARD_ATLAS_COLUMNS);
      const x = column * cell;
      const y = row * cell;
      const isDistance = index < 4;

      context.fillStyle = isDistance ? "#f2f2f2" : "#12161c";
      context.fillRect(x, y, cell, cell);
      context.strokeStyle = isDistance ? "#12161c" : "#f2f2f2";
      context.lineWidth = 5;
      context.strokeRect(x + 6, y + 6, cell - 12, cell - 12);

      context.fillStyle = isDistance ? "#12161c" : "#f2f2f2";
      context.font = "bold 68px ui-sans-serif, system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(face, x + cell / 2, y + cell / 2 + 3);
    });

    const texture = new THREE.CanvasTexture(element);
    texture.name = "boardAtlas";
    texture.anisotropy = 4;
    return texture;
  });
}

/** atlas cell index for a face value, or -1 when the value has no numeral. */
export function boardFaceIndex(face: string): number {
  return (BOARD_ATLAS_FACES as readonly string[]).indexOf(face);
}

/** crossed-quad tree canopy: an alpha-cut silhouette, deliberately soft-edged. */
export function treeCanopy(): THREE.Texture {
  return memo("treeCanopy", () => {
    const size = 128;
    const [element, context] = canvas(size, size);
    const random = mulberry32(0x7ee5_0001);

    context.clearRect(0, 0, size, size);
    // trunk
    context.fillStyle = "rgba(48,40,32,0.95)";
    context.fillRect(size / 2 - 4, size * 0.62, 8, size * 0.38);
    // canopy as overlapping blobs, so the silhouette is irregular rather than a circle
    for (let i = 0; i < 26; i++) {
      const cx = size / 2 + (random() - 0.5) * size * 0.62;
      const cy = size * 0.40 + (random() - 0.5) * size * 0.42;
      const r = size * (0.10 + random() * 0.12);
      const shade = 42 + Math.floor(random() * 38);
      context.fillStyle = `rgba(${Math.floor(shade * 0.6)},${shade},${Math.floor(shade * 0.5)},0.94)`;
      context.beginPath();
      context.arc(cx, cy, r, 0, Math.PI * 2);
      context.fill();
    }
    const texture = new THREE.CanvasTexture(element);
    texture.name = "treeCanopy";
    return texture;
  });
}
