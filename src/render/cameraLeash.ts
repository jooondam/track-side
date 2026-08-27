// The camera's leash: how far it may travel from the terrain field's anchor, and the maths that
// enforces it. Split out from CameraRig for the same reason terrainGrid is split out of
// TerrainMesh: it can be asserted in node, and the constant that couples the camera to the
// terrain then lives in exactly one place instead of being a number quoted in three comments.
//
// **Why a leash and not just OrbitControls.maxDistance.** maxDistance caps the distance from the
// camera to its own orbit *target*, and every way of moving around this scene except zooming
// translates the camera and the target together: WASD free-look, OrbitControls' own right-drag
// pan, and the double-click flight. All three keep camera-to-target constant, so maxDistance
// never trips no matter how far the pair drifts, while the terrain fade is anchored to the scene
// and does not travel with them. Holding W for a few seconds was enough to walk out past fadeEnd,
// where the field has faded to nothing and the occluder plate's straight edge is visible again:
// the exact artefact the skirt and the fade exist to remove. The cap has to be measured from the
// terrain, so that is what this does.

/**
 * the leash radius, as a multiple of the circuit's extent (its widest bounding-box span).
 *
 * 2.5 is not free choice: it is the number the terrain fade was tuned around, and it is squeezed
 * from above by fadeEnd at 2.7 * the heightfield's half-diagonal. That leaves 393 m of clearance
 * at Spa and 320 m at Monza, and terrainGrid.test.ts holds the floor at 250 m. Raising this
 * without moving fadeEnd puts the camera outside its own ground.
 */
export const CAMERA_LEASH_K = 2.5;

/** how far the camera may get from the terrain anchor, horizontally, in metres. */
export function cameraLeashM(extent: number): number {
  return extent * CAMERA_LEASH_K;
}

/**
 * the factor that scales an anchor-relative **horizontal** offset back onto the leash circle, or
 * 1 when it is already inside.
 *
 * Horizontal and not 3D, to match the fade: groundDistance() in TerrainMesh's shader is
 * `length(worldPos.xz - uAnchor.xz)` precisely so the elevation-exaggeration slider cannot make
 * the fade radius breathe. A 3D leash here would disagree with it, and would also clamp the plan
 * view, which is 4 km straight up and 43 m sideways.
 */
export function leashScale(dx: number, dz: number, leash: number): number {
  const d = Math.hypot(dx, dz);
  // d === 0 is the camera exactly over the anchor, and leash <= 0 would be a degenerate circuit;
  // in both cases there is nothing to pull back and the guard keeps a NaN out of camera.position.
  if (d <= leash || d === 0) return 1;
  return leash / d;
}
