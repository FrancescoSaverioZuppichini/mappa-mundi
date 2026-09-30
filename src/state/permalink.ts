import type { EventsData } from '../model/events'
import { focus, moveTo } from './navigation'
import { store } from './store'

// [Agent] The view lives in the URL hash as the playhead year and the span, #1942,500y or #1942,500y,Q362 with an open event, so any view can be shared or bookmarked. It stores the moment rather than the window, because a clipped window like 1692–2026 doesn't say where the playhead was. Older #start,end links (no "y") still open.

// [Agent] moveTo clamps (through momentAt) into the timeline's range: the log scale has no values past its ends, and a hand-edited link would otherwise turn into NaN.
export function restoreFromUrl(events: EventsData) {
  const [first, second = '', qid] = location.hash.slice(1).split(',')
  const a = Number(first)
  const b = Number.parseFloat(second)
  if (second.endsWith('y') && b >= 1) moveTo(a, b)
  else if (b - a >= 1) moveTo((a + b) / 2, b - a)
  const opened = qid ? events.qid.indexOf(Number(qid.slice(1))) : -1
  if (opened >= 0) focus(events, opened)
}

// [Agent] Written back with replaceState, at most every 250 ms, so scrubbing doesn't flood the history stack. The write reads the state when it fires, so it's always the latest view, even while Play changes it every frame.
export function syncToUrl(events: EventsData) {
  let timer = 0
  return store.subscribe(({ year, span, selected }, prev) => {
    if (timer || (year === prev.year && span === prev.span && selected === prev.selected)) return
    timer = window.setTimeout(() => {
      timer = 0
      const { year, span, selected } = store.getState()
      history.replaceState(null, '', `#${Math.round(year)},${Math.round(span)}y${selected === null ? '' : `,Q${events.qid[selected]}`}`)
    }, 250)
  })
}
