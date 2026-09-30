// [Agent] Responsibility: the store. Loads the data, holds the one state and update(), the only way to change it (the rules are lib/history.ts), and runs what moves by itself: Play, the story thread and the URL.

import { create } from 'zustand'
import { DEFAULTS, DWELL_MS, HEADLINE_EVERY_MS, YEAR_MAX } from '../consts'
import { apply } from '../lib/history'
import { rank } from '../lib/rank'
import { nextInStory } from '../lib/story'
import { windowOf } from '../lib/time'
import type { EventsData, HistoryPatch, HistoryState, HistoryStore } from '../types'

// [Agent] The app's store: the state and update(), the only way to change it (its rules are lib/history.ts). Components read a slice, useHistory(s => s.time), and take update the same way. getState() and subscribe() are only for code that isn't React: the map, the timeline canvas, and the loops below.

export const events = await loadEvents()

export const useHistory = create<HistoryStore>()(set => ({
  ...DEFAULTS,
  update: patch => set(prev => apply(events, prev, patch)),
}))
const { update } = useHistory.getState()

// [Agent] What runs by itself. Each reacts to a change and writes back through update(), later, never inside this callback.
useHistory.subscribe((s, prev) => {
  if (s.play.on && !prev.play.on) startPlay()
  if (s.thread !== prev.thread || s.selected !== prev.selected) scheduleHop(s, prev)
  if (s.time !== prev.time || s.selected !== prev.selected) scheduleUrl()
})

// [Agent] Play: the playhead moves speed years per second, measured in real time so it's the same on any screen. With explore on, whenever the window's top event changes (at most every few seconds), it opens.
let frame = 0
function startPlay() {
  cancelAnimationFrame(frame)
  let last = performance.now()
  let lastOpened = -Infinity
  frame = requestAnimationFrame(function step(now) {
    const { time, play, view, selected } = useHistory.getState()
    if (!play.on) return
    const year = time.year + (play.speed * (now - last)) / 1000
    last = now
    if (year >= YEAR_MAX) return update({ play: { on: false } })
    const top = rank(events, windowOf({ ...time, year }), view.hidden)[0]
    const opens = play.explore && top !== undefined && top !== selected && now - lastOpened > HEADLINE_EVERY_MS
    if (opens) lastOpened = now
    update({ time: { year }, ...(opens && { selected: top, play: {} }) })
    frame = requestAnimationFrame(step)
  })
}

// [Agent] The thread: linger on the open event, then open what happened next. It never revisits an event, so it can't loop, and it ends when the story runs out.
let hop = 0
const seen = new Set<number>()
function scheduleHop({ thread, selected }: HistoryState, prev: HistoryState) {
  clearTimeout(hop)
  if (thread && !prev.thread) seen.clear()
  if (!thread || selected === null) return
  hop = window.setTimeout(() => {
    seen.add(selected)
    const next = nextInStory(events, selected, seen)
    update(next === null ? { thread: false } : { selected: next, thread: true })
  }, DWELL_MS)
}

// [Agent] The view lives in the URL as #year,spany[,Qid], so any moment can be shared. Written at most every 250 ms: Safari throws past 100 replaceState calls in 30 s.
let urlTimer = 0
function scheduleUrl() {
  if (urlTimer) return
  urlTimer = window.setTimeout(() => {
    urlTimer = 0
    const { time, selected } = useHistory.getState()
    window.history.replaceState(null, '', `#${Math.round(time.year)},${Math.round(time.span)}y${selected === null ? '' : `,Q${events.qid[selected]}`}`)
  }, 250)
}

// [Agent] Reads #1942,500y,Q362, and the older #start,end links too.
function fromUrl(): HistoryPatch {
  const [first, second = '', qid] = location.hash.slice(1).split(',')
  const a = Number(first)
  const b = Number.parseFloat(second)
  const time = second.endsWith('y') && b >= 1 ? { year: a, span: b } : b - a >= 1 ? { year: (a + b) / 2, span: b - a } : undefined
  const selected = qid ? events.qid.indexOf(Number(qid.slice(1))) : -1
  return { ...(time && { time }), ...(selected >= 0 && { selected }) }
}

// [Agent] Start from the shared link, if any. Last in the file, because it runs the reactions above and they need every variable declared.
update(fromUrl())

// [Agent] events.bin is a u32 count, then f32 columns (positions, start, end, score, inlinks, sitelinks) and a u8 category column. Each becomes a typed-array view into the one buffer, with no copying. A missing file behind the dev server's fallback comes back as index.html with a 200, so the content type is checked too.
async function loadEvents(): Promise<EventsData> {
  const load = async (url: string) => {
    const res = await fetch(url)
    if (!res.ok || res.headers.get('content-type')?.includes('text/html')) throw new Error(`Could not load ${url} (${res.status})`)
    return res
  }
  const [buffer, meta] = await Promise.all([
    load('/data/events.bin').then(r => r.arrayBuffer()),
    load('/data/events-meta.json').then(r => r.json() as Promise<{ qid: number[]; label: string[]; article: string[] }>),
  ])
  const n = new Uint32Array(buffer, 0, 1)[0]
  return {
    count: n,
    positions: new Float32Array(buffer, 4, n * 2),
    start: new Float32Array(buffer, 4 + n * 8, n),
    end: new Float32Array(buffer, 4 + n * 12, n),
    score: new Float32Array(buffer, 4 + n * 16, n),
    inlinks: new Float32Array(buffer, 4 + n * 20, n),
    sitelinks: new Float32Array(buffer, 4 + n * 24, n),
    category: new Uint8Array(buffer, 4 + n * 28, n),
    qid: meta.qid,
    label: meta.label,
    // [Agent] "" means the enwiki title is just the label, which the export strips to save bytes.
    article: meta.article.map((a, i) => a || meta.label[i]),
  }
}
