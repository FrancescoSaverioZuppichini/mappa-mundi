// [Agent] Responsibility: the store. Loads the data, holds the one state and update(), the only way to change it (the rules are lib/history.ts), and runs what moves by itself: Play, the story thread and the URL.

import { CompressionType, setCompressionCodec, tableFromIPC } from '@uwdata/flechette'
import { decompress } from 'fzstd'
import { create } from 'zustand'
import { DEFAULTS, DWELL_MS, HEADLINE_EVERY_MS, YEAR_MAX } from '../consts'
import { CATEGORIES } from '../lib/categories'
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
    window.history.replaceState(null, '', `#${Math.round(time.year)},${Math.round(time.span)}y${selected === null ? '' : `,${events.qid[selected]}`}`)
  }, 250)
}

// [Agent] Reads #1942,500y,Q362, and the older #start,end links too.
function fromUrl(): HistoryPatch {
  const [first, second = '', qid] = location.hash.slice(1).split(',')
  const a = Number(first)
  const b = Number.parseFloat(second)
  const time = second.endsWith('y') && b >= 1 ? { year: a, span: b } : b - a >= 1 ? { year: (a + b) / 2, span: b - a } : undefined
  const selected = qid ? events.qid.indexOf(qid) : -1
  return { ...(time && { time }), ...(selected >= 0 && { selected }) }
}

// [Agent] Start from the shared link, if any. Last in the file, because it runs the reactions above and they need every variable declared.
update(fromUrl())

// [Agent] events.arrow, the same file as on Hugging Face, served by the site itself. ZSTD-compressed Feather: each column is unzipped once into its exact size, then read as a typed array over those bytes, nothing parsed (docs/zero-copy.md). The app only reads, so encode is never called. Strings decode once. Everything lives inside the function because this runs at the top of the module, before any later const exists. A missing file behind the dev server's fallback comes back as index.html with a 200, so the content type is checked too.
async function loadEvents(): Promise<EventsData> {
  setCompressionCodec(CompressionType.ZSTD, {
    decode: (bytes, size) => decompress(bytes, new Uint8Array(size)),
    encode: () => {
      throw new Error('The app never writes Arrow')
    },
  })
  const res = await fetch('/data/events.arrow')
  if (!res.ok || res.headers.get('content-type')?.includes('text/html')) throw new Error(`Could not load events.arrow (${res.status})`)
  const table = tableFromIPC(await res.arrayBuffer())
  const { category, ...columns } = table.toColumns()
  return {
    ...columns,
    count: table.numRows,
    // [Agent] The file names categories; the app indexes CATEGORIES. A name it doesn't know means the file and the code disagree, which must not pass as "battle".
    category: Uint8Array.from(category, (name: string) => {
      const id = CATEGORIES.findIndex(c => c.name === name)
      if (id < 0) throw new Error(`events.arrow has an unknown category: ${name}`)
      return id
    }),
  } as EventsData
}
