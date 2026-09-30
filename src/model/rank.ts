import type { EventsData } from './events'
import type { TimeWindow } from './time'

// [Agent] What matters in a moment. An event's importance is spread over the years it lasted, and a time window gets the share it covers. A 700-year war like the Roman–Persian Wars no longer headlines every decade it overlaps, while a battle keeps its full weight. Widen the window to the whole era and the war's share is whole again, so ranking follows the scale you're looking at.
// Years count inclusively (+1), so an event dated to a single year lasts one year, not zero.
export function shareOf(events: EventsData, i: number, [start, end]: TimeWindow) {
  const overlap = Math.min(events.end[i], end) - Math.max(events.start[i], start)
  return (Math.max(0, overlap) + 1) / (events.end[i] - events.start[i] + 1)
}

// [Agent] The window's events, most important first by their share of it. Rows arrive sorted by full score, and events wholly inside the window keep their full score, so they're already in order. Only the ones sticking out (longer than the window, or across an edge) need sorting, and then the two runs are merged.
export function rankWindow(events: EventsData, window: TimeWindow, hidden: readonly number[]): number[] {
  const [start, end] = window
  const off = new Set(hidden)
  const inside: number[] = []
  const partial: { i: number; score: number }[] = []
  for (let i = 0; i < events.count; i++) {
    if (events.start[i] > end || events.end[i] < start || off.has(events.category[i])) continue
    if (events.start[i] >= start && events.end[i] <= end) inside.push(i)
    else partial.push({ i, score: events.score[i] * shareOf(events, i, window) })
  }
  partial.sort((a, b) => b.score - a.score)
  const ranked: number[] = []
  let p = 0
  for (const i of inside) {
    while (p < partial.length && partial[p].score > events.score[i]) ranked.push(partial[p++].i)
    ranked.push(i)
  }
  for (; p < partial.length; p++) ranked.push(partial[p].i)
  return ranked
}

// [Agent] The headline of a moment, without ranking the whole window. A share never exceeds 1, so once an event's full score can't beat the best share found so far, no later row can either.
export function headlineOf(events: EventsData, window: TimeWindow, hidden: readonly number[]): number | null {
  const [start, end] = window
  let best: number | null = null
  let bestScore = 0
  for (let i = 0; i < events.count && events.score[i] > bestScore; i++) {
    if (events.start[i] > end || events.end[i] < start || hidden.includes(events.category[i])) continue
    const score = events.score[i] * shareOf(events, i, window)
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  }
  return best
}
