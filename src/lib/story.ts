// [Agent] Responsibility: "what happened next": the event that best continues a story, and distances between events.

import { YEAR_MAX } from '../consts'
import type { EventsData } from '../types'

// [Agent] "What happened next": the event that best continues the story of `from`. A candidate must start after it, and it scores higher the more important it is, the sooner it follows, and the closer it happened. Same-category events get a nudge, so wars tend to lead on to battles and treaties to treaties.
// The horizon scales with age, because the record thins out the further back you go: a few years around 1940, decades in the Middle Ages, a couple of centuries in antiquity.
const MAX_KM = 3000
const SAME_CATEGORY_BONUS = 1.3

export function nextInStory(events: EventsData, from: number, exclude: ReadonlySet<number>): number | null {
  const start = events.start[from]
  const horizon = Math.max(4, (YEAR_MAX - start) * 0.04)
  let best: number | null = null
  let bestWeight = 0
  for (let j = 0; j < events.count; j++) {
    const gap = events.start[j] - start
    if (gap <= 0 || gap > horizon * 4 || j === from || exclude.has(j)) continue
    const km = distanceKm(events, from, j)
    if (km > MAX_KM) continue
    const weight = (events.score[j] / (1 + gap / horizon) / (1 + km / 800)) * (events.category[j] === events.category[from] ? SAME_CATEGORY_BONUS : 1)
    if (weight > bestWeight) {
      best = j
      bestWeight = weight
    }
  }
  return best
}

// [Agent] How far apart two events are, for captions like "12 years later · 340 km away".
export function distanceKm(events: EventsData, a: number, b: number) {
  const cosLat = Math.cos((events.lat[a] * Math.PI) / 180)
  const dLon = ((events.lon[b] - events.lon[a] + 540) % 360) - 180
  return Math.hypot(dLon * cosLat * 111.3, (events.lat[b] - events.lat[a]) * 110.6)
}
