// [Agent] Responsibility: the shapes more than one file shares: the data, the state and its patches, and the epoch config.

// [Agent] The events as columns, exactly as events.arrow stores them: row i of every array is event i. Rows are sorted by score, most important first, so row 0 is the most important event in history. scripts/export-events.ts writes the file, hooks/useHistory.ts loads it. The numeric columns are views over the file's bytes; category is the CATEGORIES index of the file's category name.
export type EventsData = {
  count: number
  qid: string[]
  label: string[]
  article: string[]
  category: Uint8Array
  start: Float32Array
  end: Float32Array
  lon: Float32Array
  lat: Float32Array
  score: Float32Array
  inlinks: Float32Array
  sitelinks: Float32Array
}

// [Agent] One event's Wikipedia text, as worker/index.ts serves it from D1. lead_html is cleaned by scripts/fetch-leads.ts: <p> paragraphs with text, bold, italics and /wiki/ links.
export type Lead = { description: string | null; lead_html: string | null; thumbnail: string | null }

export type TimeWindow = [start: number, end: number]

export type HistoryState = {
  // [Agent] Where you are: the playhead year and how many years around it you look at. The window of shown events is derived from these (windowOf), never stored.
  time: { year: number; span: number }
  // [Agent] The open event.
  selected: number | null
  // [Agent] What you see. detail runs 0..1 (how many bubbles the screen may hold), hidden lists the category ids switched off.
  view: { detail: number; hidden: number[]; projection: 'globe' | 'mercator' }
  // [Agent] Time moving by itself: speed in years per second, and explore opens each moment's headline while the camera follows.
  play: { on: boolean; speed: number; explore: boolean }
  // [Agent] Hopping from event to event along "what happened next".
  thread: boolean
  tour: boolean
  // [Agent] What the globe drew in its last pass, for the header's counts. Written by the globe only.
  drawn: { target: number; shown: number; population: number; minInlinks: number }
}

// [Agent] What update() takes: any fields, and within a group only the ones that change.
export type HistoryPatch = {
  time?: Partial<HistoryState['time']>
  selected?: number | null
  view?: Partial<HistoryState['view']>
  play?: Partial<HistoryState['play']>
  thread?: boolean
  tour?: boolean
  drawn?: HistoryState['drawn']
}

// [Agent] The store: the state and the one way to change it, like [history, setHistory].
export type HistoryStore = HistoryState & { update: (patch: HistoryPatch) => void }

// [Agent] The event under the pointer on the globe, and where, for the tooltip.
export type HoveredEvent = { index: number; x: number; y: number } | null

// [Agent] One font file for map labels: a fontsource family, a unicode subset and a weight. The file lives at public/fonts/map/<family>-<subset>-<weight>.ttf.
export type MapFont = { family: string; subset: 'latin' | 'latin-ext'; weight: number }

export type TextureName = 'papyrus' | 'vellum' | 'grain' | 'waves' | 'engraving'

export type EpochConfig = {
  id: string
  name: string
  from: number
  font: string
  // [Agent] The map labels' font files, one per unicode subset. MapLibre renders these TTFs itself through the style's font-faces, so map labels share the epoch's typography. scripts/fetch-fonts.ts downloads them into public/fonts/map/.
  mapFonts: MapFont[]
  // [Agent] onSpace and highlight are for chrome sitting on the dark space around the globe. Every epoch's space is dark, and its paper-tuned accent (crimson, sepia) would be illegible there, so highlight is a lighter version of the same hue.
  ui: { paper: string; ink: string; accent: string; space: string; onSpace: string; highlight: string }
  map: {
    ocean: string
    oceanTexture: TextureName | null
    land: string
    landTexture: TextureName | null
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
