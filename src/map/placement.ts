import type { EventsData } from '../model/events'
import { formatYears } from '../model/time'
import type { Lod } from '../state/store'

// [Agent] Level of detail: which events get a bubble, and which bubbles get a label, for the current view. Pure: it sees the screen only through a Viewport, so it knows nothing about MapLibre.
// 1. Pool: the events of the time window, ranked by their share of it (model/rank.ts). Only the top share competes, 30% at the default zoom and doubling per zoom level, but never fewer than 3x the target so sparse eras aren't starved. Zooming in lowers the bar.
// 2. Order: pinned events first (the open one and a trip's destination), then events already on screen, then newcomers, each group in rank order. An event stays until it leaves the view or collides with another incumbent, so panning can't make it flicker.
// 3. Greedy fit with exact rectangles: a bubble is kept if it doesn't overlap anything placed before it, and the first LABEL_BUDGET kept also get a label if theirs fits. Label side and type size are sticky too; otherwise one label dropping out would bump every later label up a size and knock out neighbours in a cascade.
// Bubble size is the event's percentile within the window, so each era's headliners are big whatever their raw link count.

export type Viewport = {
  width: number
  height: number
  zoom: number
  // [Agent] Screen position of a point, or null when it isn't visible (off screen, or on the far side of the globe).
  locate(lon: number, lat: number): { x: number; y: number } | null
}
export type Anchor = 'left' | 'right'
export type Placement = { index: number; radius: number; size: number; tier: number; anchor: Anchor; when: string; labeled: boolean; headline: boolean }
export type Previous = ReadonlyMap<number, { anchor: Anchor; tier: number }>
// [Agent] `ranked` is the window's events, most important first, from rankWindow.
type Query = { ranked: readonly number[]; pinned: number[]; detail: number; font: string }
type Box = [x0: number, y0: number, x1: number, y1: number]

const BASE_ZOOM = 1.8
const BASE_SHARE = 0.3
// [Agent] Geometric hysteresis: an event needs its full box to enter, but an incumbent only has to fit a box shrunk by this many pixels to stay, so neighbours brushing past each other during a globe rotation don't knock one out for a frame.
const STAY_SLACK = 4
const LABEL_BUDGET = 32
// [Agent] The first labels placed belong to the most important events in this view, so they get the largest type whatever the zoom. Every view gets its own headlines.
const TIER_SIZES = [14, 12.5, 11]
const TIER_ENDS = [5, 18]
const MAX_LABEL_CHARS = 38
// [Agent] Caps locate() calls per pass. Candidates arrive in rank order, so by this many the screen is long full.
const MAX_CANDIDATES = 5000
const BUCKET = 64

// [Agent] The Detail slider runs 0..1 on a log scale, from 25 to 600 events on screen.
export function detailTarget(detail: number) {
  return Math.round(25 * 24 ** detail)
}

export function truncateLabel(label: string) {
  return label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label
}

const measure = new OffscreenCanvas(1, 1).getContext('2d')!

// [Agent] `previous` is the last pass's result, or null to place from scratch, as after a zoom or a filter change.
export function placeEvents(events: EventsData, viewport: Viewport, query: Query, previous: Previous | null): { placed: Placement[]; lod: Lod } {
  const { ranked } = query
  const population = ranked.length
  const target = detailTarget(query.detail)
  const pool = Math.max(Math.ceil(population * Math.min(1, BASE_SHARE * 2 ** (viewport.zoom - BASE_ZOOM))), target * 3)
  const locate = (i: number) => viewport.locate(events.positions[i * 2], events.positions[i * 2 + 1])

  // [Agent] 1 and 2. Pinned events join even from outside the pool or their time window, at full size and always labelled, so the open event never vanishes from the map and a trip's destination is there when the camera lands.
  const pinned = new Set(query.pinned)
  const candidates: { i: number; x: number; y: number; percentile: number; order: number }[] = []
  for (const i of pinned) {
    const at = locate(i)
    if (at) candidates.push({ i, ...at, percentile: 1, order: -1 })
  }
  for (let rank = 0; rank < Math.min(pool, population) && candidates.length < MAX_CANDIDATES; rank++) {
    const i = ranked[rank]
    const percentile = 1 - rank / population
    const at = pinned.has(i) ? null : locate(i)
    if (at) candidates.push({ i, ...at, percentile, order: previous?.has(i) ? rank : rank + population })
  }
  candidates.sort((a, b) => a.order - b.order)

  // [Agent] 3. Exact rectangle collisions, bucketed into a coarse spatial hash so each test only looks at nearby boxes.
  const boxes: Box[] = []
  const buckets = new Map<number, number[]>()
  const keysOf = ([x0, y0, x1, y1]: Box) => {
    const keys: number[] = []
    for (let by = Math.floor(y0 / BUCKET); by <= Math.floor(y1 / BUCKET); by++)
      for (let bx = Math.floor(x0 / BUCKET); bx <= Math.floor(x1 / BUCKET); bx++) keys.push((by + 64) * 4096 + bx + 64)
    return keys
  }
  const fits = ([x0, y0, x1, y1]: Box, slack: number) => {
    const box: Box = [x0 + slack, y0 + slack, x1 - slack, y1 - slack]
    return keysOf(box).every(key => (buckets.get(key) ?? []).every(id => {
      const [bx0, by0, bx1, by1] = boxes[id]
      return box[0] >= bx1 || box[2] <= bx0 || box[1] >= by1 || box[3] <= by0
    }))
  }
  const add = (box: Box) => {
    const id = boxes.push(box) - 1
    for (const key of keysOf(box)) {
      const bucket = buckets.get(key)
      if (bucket) bucket.push(id)
      else buckets.set(key, [id])
    }
  }

  const placed: Placement[] = []
  let labeled = 0
  for (const { i, x, y, percentile } of candidates) {
    if (placed.length >= target) break
    // [Agent] Cubed percentile, so only the window's real headliners get large bubbles.
    const radius = 3 + 7 * percentile ** 3
    const before = previous?.get(i)
    const slack = before ? STAY_SLACK : 0
    const bubble: Box = [x - radius - 2, y - radius - 2, x + radius + 2, y + radius + 2]
    if (!fits(bubble, slack)) continue

    const tier = before?.tier ?? (labeled < TIER_ENDS[0] ? 0 : labeled < TIER_ENDS[1] ? 1 : 2)
    const size = TIER_SIZES[tier]
    const when = formatYears(events.start[i], events.end[i])
    let label: Box | null = null
    let anchor: Anchor = 'left'
    if (labeled < LABEL_BUDGET || pinned.has(i)) {
      measure.font = `${size}px ${query.font}`
      const w = Math.max(measure.measureText(truncateLabel(events.label[i])).width, measure.measureText(when).width * 0.8) + 6
      const h = size * 2.2
      const sides: Record<Anchor, Box> = {
        left: [x + radius + 4, y - h / 2, x + radius + 4 + w, y + h / 2],
        right: [x - radius - 4 - w, y - h / 2, x - radius - 4, y + h / 2],
      }
      // [Agent] An incumbent keeps its side while it fits. A newcomer tries the side facing the screen centre first, so labels lean into the globe instead of hanging off its edge.
      const preferred = before?.anchor ?? (x < viewport.width / 2 ? 'left' : 'right')
      anchor = fits(sides[preferred], slack) ? preferred : preferred === 'left' ? 'right' : 'left'
      label = fits(sides[anchor], slack) ? sides[anchor] : null
    }
    add(bubble)
    if (label) {
      add(label)
      labeled++
    }
    placed.push({ index: i, radius, size, tier, anchor, when, labeled: label !== null, headline: label !== null && tier === 0 })
  }

  const minInlinks = placed.reduce((min, p) => Math.min(min, events.inlinks[p.index]), placed.length ? Infinity : 0)
  return { placed, lod: { target, minInlinks, population, shown: placed.length } }
}
