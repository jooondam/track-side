// the circuit registry: an id and a display name, and nothing else.
//
// Corner names and arc lengths used to live here. They moved to public/<circuit>/landmarks.json
// at M9 for three reasons: it is 100+ entries per circuit once braking boards are counted, and a
// TS module ships every circuit's data to every visitor in the JS bundle; the arc lengths want
// validating against generated geometry, which is a Python job; and the s frame has to be the
// generated racing line's own, so the file has to be written by the run that generates the line.
//
// Anything circuit-specific beyond these two fields belongs in the artifact, not here.

export interface TrackDefinition {
  id: string;
  displayName: string;
}

export const TRACKS: TrackDefinition[] = [
  { id: "spa", displayName: "Spa-Francorchamps" },
  { id: "monza", displayName: "Monza" },
];
