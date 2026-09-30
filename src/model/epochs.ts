// [Agent] Each epoch is a different kind of map, not just a recolour: its own paper, sea treatment, relief ink, decorations and typography. mapStyle.ts turns a look into layer paint, and textures.ts paints the named textures.
export type Texture = 'papyrus' | 'vellum' | 'grain' | 'waves' | 'engraving'

export type Epoch = {
  id: string
  name: string
  from: number
  font: string
  // [Agent] Fontsource file stems for map labels, in the "<family>@<version>/<subset>-<weight>" form. MapLibre renders these TTFs itself through the style's font-faces, so the map labels share the epoch's typography. Each subset covers its own unicode range.
  mapFonts: string[]
  // [Agent] onSpace and highlight are for chrome sitting on the dark space around the globe. Every epoch's space is dark, and its paper-tuned accent (crimson, sepia) would be illegible there, so highlight is a lighter version of the same hue.
  ui: { paper: string; ink: string; accent: string; space: string; onSpace: string; highlight: string }
  map: {
    ocean: string
    oceanTexture: Texture | null
    land: string
    landTexture: Texture | null
    satellite: boolean
    relief: { shadow: string; highlight: string; accent: string; strength: number } | null
    ripples: string | null
    graticule: string | null
    rhumbs: { main: string; half: string } | null
    polities: string[]
    polityOpacity: number
    border: string
    borderWidth: number
    borderGlow: string | null
    river: string
    label: string
    halo: string
  }
}

export const EPOCHS: Epoch[] = [
  {
    id: 'antiquity',
    name: 'Antiquity',
    from: -3000,
    font: "'Cinzel', serif",
    mapFonts: ['cinzel@latest/latin-600', 'cinzel@latest/latin-ext-600'],
    ui: { paper: '#efe2c4', ink: '#3b2a1a', accent: '#a4502a', space: '#1b140d', onSpace: '#efe2c4', highlight: '#e59866' },
    map: {
      ocean: '#b7a57f', oceanTexture: 'papyrus',
      land: '#e8d6ab', landTexture: 'papyrus',
      satellite: false,
      relief: { shadow: '#5e4024', highlight: '#f6e9c8', accent: '#8a6a44', strength: 0.55 },
      ripples: '#6d5433',
      graticule: null,
      rhumbs: null,
      polities: ['#d9a066', '#c98a5a', '#e0b77a', '#b87d4b', '#d4a373', '#c28f5c', '#e3c08d', '#a86f44'],
      polityOpacity: 0.42,
      border: '#5a3a1e', borderWidth: 1.1, borderGlow: null,
      river: '#7d6a48',
      label: '#3b2a1a', halo: '#efe2c4',
    },
  },
  {
    id: 'medieval',
    name: 'Middle Ages',
    from: 500,
    font: "'Almendra', serif",
    mapFonts: ['almendra@latest/latin-400', 'almendra@latest/latin-ext-400'],
    ui: { paper: '#f2e7cd', ink: '#2b1b12', accent: '#9b1c1c', space: '#140e0a', onSpace: '#f2e7cd', highlight: '#e8705c' },
    map: {
      ocean: '#2c4a78', oceanTexture: 'waves',
      land: '#efe3c3', landTexture: 'vellum',
      satellite: false,
      relief: { shadow: '#6d5a3c', highlight: '#fff6dc', accent: '#8c7250', strength: 0.35 },
      ripples: null,
      graticule: null,
      rhumbs: null,
      polities: ['#b33a3a', '#c9a227', '#4a6fa5', '#6a8d4f', '#8e5572', '#c26d3a', '#5b7f8c', '#a4863d'],
      polityOpacity: 0.38,
      border: '#3a1a10', borderWidth: 1.2, borderGlow: '#d4a72c',
      river: '#2c4a78',
      label: '#2b1b12', halo: '#f2e7cd',
    },
  },
  {
    id: 'sail',
    name: 'Age of Sail',
    from: 1500,
    font: "'IM Fell English', serif",
    mapFonts: ['im-fell-english@latest/latin-400', 'noto-serif@latest/latin-ext-400'],
    ui: { paper: '#f6efdc', ink: '#2d2a26', accent: '#8b3a2b', space: '#1a2126', onSpace: '#f6efdc', highlight: '#e3836a' },
    map: {
      ocean: '#d5e2d8', oceanTexture: 'grain',
      land: '#f3ead2', landTexture: 'grain',
      satellite: false,
      relief: { shadow: '#7a5c3e', highlight: '#fffaf0', accent: '#9c7b58', strength: 0.45 },
      ripples: '#6f8f96',
      graticule: '#8b3a2b',
      rhumbs: { main: '#2d2a26', half: '#8b3a2b' },
      polities: ['#e8b4a0', '#b8d4a8', '#f0d58c', '#a8c4dc', '#d8b4d8', '#f2c7a0', '#c4d8b0', '#e0c0a8'],
      polityOpacity: 0.6,
      border: '#8b3a2b', borderWidth: 1, borderGlow: null,
      river: '#6f8f96',
      label: '#2d2a26', halo: '#f6efdc',
    },
  },
  {
    id: 'industrial',
    name: 'Industrial Age',
    from: 1800,
    font: "'Playfair Display', serif",
    mapFonts: ['playfair-display@latest/latin-600', 'playfair-display@latest/latin-ext-600'],
    ui: { paper: '#e9e1cf', ink: '#1f1c18', accent: '#7a2e1f', space: '#111417', onSpace: '#e9e1cf', highlight: '#d99a73' },
    map: {
      ocean: '#a3b6bf', oceanTexture: 'engraving',
      land: '#ede5d1', landTexture: null,
      satellite: false,
      relief: { shadow: '#3f3f3f', highlight: '#ffffff', accent: '#6b6b6b', strength: 0.5 },
      ripples: null,
      graticule: '#56666e',
      rhumbs: null,
      polities: ['#e8a0a8', '#f0d878', '#a8cc8c', '#c0a8d8', '#f0b880', '#98bcd8', '#d8c8a0', '#b8d0c0'],
      polityOpacity: 0.72,
      border: '#1f1c18', borderWidth: 1.2, borderGlow: null,
      river: '#5f7d8c',
      label: '#1f1c18', halo: '#ede5d1',
    },
  },
  {
    id: 'modern',
    name: 'Modern',
    from: 1945,
    font: "'Inter', sans-serif",
    mapFonts: ['inter@latest/latin-500', 'inter@latest/latin-ext-500'],
    ui: { paper: '#0e1522', ink: '#e6edf5', accent: '#4cc9f0', space: '#03050a', onSpace: '#e6edf5', highlight: '#4cc9f0' },
    map: {
      ocean: '#06101f', oceanTexture: null,
      land: '#162235', landTexture: null,
      satellite: true,
      relief: null,
      ripples: null,
      graticule: null,
      rhumbs: null,
      polities: ['#4cc9f0', '#f72585', '#b5179e', '#7209b7', '#4361ee', '#4895ef', '#3a0ca3', '#560bad'],
      polityOpacity: 0.14,
      border: '#bfe9ff', borderWidth: 0.8, borderGlow: '#4cc9f0',
      river: '#1d3b5c',
      label: '#e6edf5', halo: '#03050a',
    },
  },
]

export function epochAt(year: number) {
  return EPOCHS.findLast(e => e.from <= year) ?? EPOCHS[0]
}
