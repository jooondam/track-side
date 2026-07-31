// track registry: everything circuit-specific the viewer needs beyond the generated assets.
// corner arc-length positions are hand-placed estimates (the TUMFTM centerlines start near
// each circuit's real start/finish line, verified for Spa against the elevation profile's
// landmarks), good enough for floating labels; nudge by eye if a label sits off its corner.

export interface CornerLabel {
  name: string;
  sM: number;
}

export interface TrackDefinition {
  id: string;
  displayName: string;
  corners: CornerLabel[];
}

export const TRACKS: TrackDefinition[] = [
  {
    id: "spa",
    displayName: "Spa-Francorchamps",
    corners: [
      { name: "La Source", sM: 420 },
      { name: "Eau Rouge", sM: 1050 },
      { name: "Raidillon", sM: 1250 },
      { name: "Les Combes", sM: 2650 },
      { name: "Bruxelles", sM: 3350 },
      { name: "Pouhon", sM: 4100 },
      { name: "Stavelot", sM: 5000 },
      { name: "Blanchimont", sM: 5900 },
      { name: "Bus Stop", sM: 6800 },
    ],
  },
  {
    id: "monza",
    displayName: "Monza",
    corners: [
      { name: "Variante del Rettifilo", sM: 620 },
      { name: "Curva Grande", sM: 1100 },
      { name: "Variante della Roggia", sM: 1850 },
      { name: "Lesmo 1", sM: 2450 },
      { name: "Lesmo 2", sM: 2750 },
      { name: "Variante Ascari", sM: 4000 },
      { name: "Parabolica", sM: 5000 },
    ],
  },
];
