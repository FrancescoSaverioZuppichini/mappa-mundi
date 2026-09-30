import { createStore } from 'zustand/vanilla'
import { momentAt, type Moment } from '../model/time'

// [Agent] What a placement pass did: how many events it aimed for and fitted out of the window's population, and the smallest in-degree among those shown.
export type Lod = { target: number; minInlinks: number; population: number; shown: number }

// [Agent] A vanilla store: the map and the timeline subscribe to it directly, outside React, so dragging the time window never costs a React render. React components read it via `useStore(store, selector)`.
// [Agent] The moment (playhead year, span, and the window they cover) is always written whole, from momentAt.
export type AtlasState = Moment & {
  projection: 'globe' | 'mercator'
  hovered: { index: number; x: number; y: number } | null
  selected: number | null
  // [Agent] Category ids (indexes into CATEGORIES) that the category menu has switched off.
  hiddenCategories: number[]
  // [Agent] The Detail slider, 0..1 on a log scale of how many events the screen should hold (see detailTarget).
  detail: number
  // [Agent] What the last placement pass did: written by the atlas, read by the header.
  lod: Lod
  tourOpen: boolean
  // [Agent] The event a trip is flying to (navigation.ts). It becomes `selected` on arrival, and placement pins it until then.
  flight: number | null
  // [Agent] The latest camera command, set only by navigation.ts and executed by the map. 'reveal' brings an event into view if it isn't already, 'travel' is the time machine's arc, and 'glide' is Play's slow drift toward the headline of the moment. A new object is a new command, so re-sending the same event still moves the camera.
  camera: { index: number; mode: 'reveal' | 'travel' | 'glide' } | null
  // [Agent] Autoplay states: time sweeping forward (at playSpeed years per second), and the story thread hopping on. autoExplore makes Play open each moment's headline and glide the camera to it.
  playing: boolean
  playSpeed: number
  autoExplore: boolean
  following: boolean
}

export const store = createStore<AtlasState>(() => ({
  ...momentAt(1750, 100),
  projection: 'globe',
  hovered: null,
  selected: null,
  hiddenCategories: [],
  detail: 0.5,
  lod: { target: 0, minInlinks: 0, population: 0, shown: 0 },
  tourOpen: false,
  flight: null,
  camera: null,
  playing: false,
  playSpeed: 10,
  autoExplore: true,
  following: false,
}))
