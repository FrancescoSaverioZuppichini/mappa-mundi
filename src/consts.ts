// [Agent] Responsibility: the numbers that define how the app behaves, in one place to tune, and the default state.

import type { HistoryState } from './types.ts'

// [Agent] The numbers that define how the app behaves, in one place to tune.

export const YEAR_MIN = -3000
export const YEAR_MAX = 2026

export const SPANS = [1, 10, 25, 50, 100, 500]
export const PLAY_SPEEDS = [1, 2, 5, 10, 25, 50, 100]
// [Agent] Play opens a new headline at most this often, so each one stays up long enough to read.
export const HEADLINE_EVERY_MS = 3500
// [Agent] How long the thread lingers on an event before moving on: enough to read the summary.
export const DWELL_MS = 10_000
// [Agent] Surprise me draws from the most linked few thousand: famous enough to have a story, not always the same ten.
export const SURPRISE_POOL = 6000

// [Agent] The characters each font subset covers, so the browser and MapLibre fetch a subset only when a label needs it. Shared by the map's font-faces and the UI's @font-face rules (scripts/fetch-fonts.ts).
export const UNICODE_RANGES = {
  latin: ['U+0000-00FF', 'U+0131', 'U+0152-0153', 'U+02BB-02BC', 'U+02C6', 'U+02DA', 'U+02DC', 'U+2000-206F', 'U+20AC', 'U+2122', 'U+2191', 'U+2193', 'U+2212', 'U+2215', 'U+FEFF', 'U+FFFD'],
  'latin-ext': ['U+0100-024F', 'U+0259', 'U+1E00-1EFF', 'U+2020', 'U+20A0-20AB', 'U+20AD-20CF', 'U+2113', 'U+2C60-2C7F', 'U+A720-A7FF'],
}

export const DEFAULTS: HistoryState = {
  time: { year: 1750, span: 50 },
  selected: null,
  view: { detail: 0.5, hidden: [], projection: 'globe' },
  play: { on: false, speed: 10, explore: true },
  thread: false,
  tour: false,
  drawn: { target: 0, shown: 0, population: 0, minInlinks: 0 },
}
