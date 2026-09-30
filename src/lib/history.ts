// [Agent] Responsibility: every rule of the state, as one pure function: apply(prev, patch) returns the next state.

import { YEAR_MAX, YEAR_MIN } from '../consts'
import type { EventsData, HistoryPatch, HistoryState } from '../types'
import { windowOf } from './time'

// [Agent] Every rule of the app, as one pure function: the next state from the previous one and a patch.
// A patch names only what changes, and a group is replaced only when the patch touches it, so a component reading `time` doesn't re-render when `view` changes.
export function apply(events: EventsData, prev: HistoryState, patch: HistoryPatch): HistoryState {
  const next: HistoryState = {
    ...prev,
    ...patch,
    time: patch.time ? { ...prev.time, ...patch.time } : prev.time,
    view: patch.view ? { ...prev.view, ...patch.view } : prev.view,
    play: patch.play ? { ...prev.play, ...patch.play } : prev.play,
  }
  if (patch.time) next.time = { year: Math.min(Math.max(next.time.year, YEAR_MIN), YEAR_MAX), span: Math.min(Math.max(next.time.span, 1), YEAR_MAX - YEAR_MIN) }
  const inView = (i: number) => {
    const [start, end] = windowOf(next.time)
    return events.start[i] <= end && events.end[i] >= start
  }
  // [Agent] Opening an event takes you to its time. Moving time off the open event closes it.
  if (patch.selected != null && !inView(patch.selected)) next.time = { ...next.time, year: events.start[patch.selected] }
  if (next.selected !== null && !inView(next.selected)) next.selected = null
  // [Agent] Picking an event is taking the wheel: Play and the thread stop, unless the patch keeps them on (their own loops do).
  if ('selected' in patch && !patch.play && next.play.on) next.play = { ...next.play, on: false }
  if ('selected' in patch && patch.thread === undefined) next.thread = false
  // [Agent] Play starts from the moment itself, not from whatever was open.
  if (next.play.on && !prev.play.on) next.selected = null
  return next
}
