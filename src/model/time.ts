import { format } from 'date-fns'

export const YEAR_MIN = -3000
export const YEAR_MAX = 2026

export type TimeWindow = [start: number, end: number]

const MIN_SPAN = 1

// [Agent] Where you are in time: the playhead year, the span of years around it, and the window of events that span covers. The window is clipped at either end of history rather than slid back inside, so the playhead stays exactly where it was put. That matters because the borders and the era look follow the playhead: pick a 500-year span in 1942 and the map still shows 1942's world. Every move builds one of these, so the three never disagree.
export type Moment = { year: number; span: number; timeWindow: TimeWindow }

export function momentAt(year: number, span: number): Moment {
  const s = Math.min(Math.max(span, MIN_SPAN), YEAR_MAX - YEAR_MIN)
  const y = Math.min(Math.max(year, YEAR_MIN), YEAR_MAX)
  return { year: y, span: s, timeWindow: [Math.max(YEAR_MIN, y - s / 2), Math.min(YEAR_MAX, y + s / 2)] }
}

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
