// [Agent] Responsibility: what matters in a moment: rank(events, window, hidden), ordered by score × share of the window.

import type { EventsData, TimeWindow } from '../types'

// [Agent] What matters in a moment. An event's score is spread over the years it lasted, and a window gets the share that falls inside it. A 700-year war no longer headlines every decade it overlaps, while a battle keeps its full score. Widen the window to the whole era and the war's share is whole again, so ranking follows the scale you look at.
// Years count inclusively (+1), so an event dated to a single year lasts one year, not zero.
export function shareOf(events: EventsData, i: number, [start, end]: TimeWindow) {
  const overlap = Math.min(events.end[i], end) - Math.max(events.start[i], start)
  return (Math.max(0, overlap) + 1) / (events.end[i] - events.start[i] + 1)
}

// [Agent] The window's events, most important first by score × share. The map, the timeline, the panel and Play all ask for the same window in the same frame, so the last answer is kept and handed back when the question repeats.
let last: { events: EventsData; start: number; end: number; hidden: readonly number[]; ranked: number[] } | null = null
export function rank(events: EventsData, window: TimeWindow, hidden: readonly number[] = []): number[] {
  const [start, end] = window
  if (last?.events === events && last.start === start && last.end === end && last.hidden === hidden) return last.ranked
  const inView: number[] = []
  for (let i = 0; i < events.count; i++) if (events.start[i] <= end && events.end[i] >= start && !hidden.includes(events.category[i])) inView.push(i)
  const score = (i: number) => events.score[i] * shareOf(events, i, window)
  last = { events, start, end, hidden, ranked: inView.sort((a, b) => score(b) - score(a)) }
  return last.ranked
}
