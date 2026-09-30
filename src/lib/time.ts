// [Agent] Responsibility: time math: the timeline's log scale (yearToT, tToYear), windowOf, and year formatting.

import { format } from 'date-fns'
import { YEAR_MAX, YEAR_MIN } from '../consts'
import type { TimeWindow } from '../types'

// [Agent] The timeline position t (0..1) is the log of "years before YEAR_MAX", offset by K so the present doesn't stretch to infinity. K = 150 gives antiquity roughly a quarter of the bar and the last two centuries another quarter, which is roughly how the events are distributed.
const K = 150
const LOG_FAR = Math.log(YEAR_MAX - YEAR_MIN + K)
const LOG_NEAR = Math.log(K)

export function yearToT(year: number) {
  return (LOG_FAR - Math.log(YEAR_MAX - year + K)) / (LOG_FAR - LOG_NEAR)
}

export function tToYear(t: number) {
  return YEAR_MAX + K - Math.exp(LOG_FAR - t * (LOG_FAR - LOG_NEAR))
}

// [Agent] The years whose events are shown: span years around the playhead, cut off at either end of history. Cut off, not slid back inside, so the playhead stays where it was put: 1942 with a 500-year span is 1692–2026, still centred on 1942's world.
export function windowOf({ year, span }: { year: number; span: number }): TimeWindow {
  return [Math.max(YEAR_MIN, year - span / 2), Math.min(YEAR_MAX, year + span / 2)]
}

// [Agent] One formatter for a single year and for a span. A span only prints as a range when its ends round to different years.
// Our years skip zero the way historians count (-1 is 1 BC). JS dates count astronomically (year 0 is 1 BC), so BC years shift by one before date-fns reads the era. Years from 1000 on drop the era, since "1492 AD" is noise.
export function formatYears(start: number, end = start) {
  const label = (year: number) => {
    const y = Math.round(year)
    const date = new Date(2000, 0, 1)
    date.setFullYear(y < 0 ? y + 1 : Math.max(y, 1))
    return format(date, y < 1000 ? 'y G' : 'y')
  }
  return Math.round(start) === Math.round(end) ? label(start) : `${label(start)} – ${label(end)}`
}
