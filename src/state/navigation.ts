import type { EventsData } from '../model/events'
import { headlineOf } from '../model/rank'
import { nextInStory } from '../model/story'
import { momentAt, tToYear, YEAR_MAX, yearToT } from '../model/time'
import { store } from './store'

// [Agent] Navigation: the one writer of where you are (the moment), what's open (selected), trips (flight), camera commands and the two autoplays. Every way the view moves goes through here. That covers clicking a bubble, search, related lists, shared links, the time machine, following a story thread and playing through time. This module is the one owner of the selection, the time-window moves and the camera requests, so everything else only asks to go somewhere.
// Every user entry point interrupts the two autoplays (Play and the thread), so any user action takes over without anyone else needing to know they exist.

const TRAVEL_MS = 2400
// [Agent] How long the thread lingers on each event before moving on: enough to read the summary.
export const DWELL_MS = 10_000
// [Agent] The time machine draws uniformly from the most linked few thousand: famous enough to have a story, not always the same ten headliners.
const SURPRISE_POOL = 6000

// [Agent] Play speeds, in years per second, that the speed control steps through.
export const PLAY_SPEEDS = [1, 2, 5, 10, 25, 50, 100]
// [Agent] Play opens a new headline at most this often, so each one is on screen long enough to read its title and the camera drifts instead of twitching.
const HEADLINE_EVERY_MS = 3500

let flightId = 0
let dwellTimer = 0
let playFrame = 0
const surprised = new Set<number>()
const thread = new Set<number>()

// [Agent] Open or close an event where it is, as when clicking a bubble or closing the panel. The camera stays put.
export function select(i: number | null) {
  interrupt()
  store.setState({ selected: i, flight: null })
}

// [Agent] Jump to an event from anywhere: the time window keeps its span and re-centres on the event unless it already falls inside, and the map is asked to reveal it.
export function focus(events: EventsData, i: number) {
  interrupt()
  const { timeWindow: [start, end], span } = store.getState()
  const inside = events.start[i] <= end && events.end[i] >= start
  store.setState({
    selected: i,
    flight: null,
    camera: { index: i, mode: 'reveal' },
    ...(inside ? {} : momentAt(events.start[i], span)),
  })
}

// [Agent] Time moves because the user moved it: the timeline, a span button, the tour, a shared link. A trip in flight is cancelled so it stops fighting the user's hand, and the thread stops. Play keeps running from the new place.
export function moveTo(year: number, span = store.getState().span) {
  flightId++
  stopFollowing()
  store.setState(momentAt(year, span))
}

// [Agent] The cinematic trip to one event, chosen by the user.
export function travelTo(events: EventsData, i: number) {
  interrupt()
  fly(events, i)
}

// [Agent] The time machine: a trip to a notable event not yet seen this session.
export function surprise(events: EventsData) {
  const pool = Math.min(SURPRISE_POOL, events.count)
  if (surprised.size >= pool) surprised.clear()
  let i = Math.floor(Math.random() * pool)
  while (surprised.has(i)) i = Math.floor(Math.random() * pool)
  surprised.add(i)
  travelTo(events, i)
}

// [Agent] Autoplay along "what happened next": hop, linger, hop, until the story runs out or the user takes over. A thread never revisits an event, so it can't loop.
export function follow(events: EventsData) {
  interrupt()
  thread.clear()
  store.setState({ following: true })
  hop(events)
}

// [Agent] Skip the rest of the current dwell and hop now.
export function followNow(events: EventsData) {
  clearTimeout(dwellTimer)
  hop(events)
}

export function stopFollowing() {
  clearTimeout(dwellTimer)
  if (store.getState().following) store.setState({ following: false })
}

// [Agent] Play is a documentary: time moves forward at `playSpeed` years per second. With auto-explore on, whenever the headline of the moment (the most important event of the window, model/rank.ts) changes, it opens while the camera glides over to it. With it off, only time moves. The window slides in years, so "1 year a second" means exactly that. Changing the speed, the span or auto-explore, or dragging the timeline, all apply mid-play, because each frame starts from the current state.
export function play(events: EventsData) {
  interrupt()
  store.setState({ playing: true, selected: null })
  let last = performance.now()
  let lastHeadline = -Infinity
  playFrame = requestAnimationFrame(function step(now) {
    const { year, span, hiddenCategories, playSpeed, autoExplore, selected } = store.getState()
    const years = (playSpeed * (now - last)) / 1000
    last = now
    // [Agent] Runs until the playhead reaches today. The window's far edge is clipped at 2026 long before that on a wide span.
    if (year + years >= YEAR_MAX) return pause()
    const next = momentAt(year + years, span)
    const headline = autoExplore ? headlineOf(events, next.timeWindow, hiddenCategories) : null
    const opens = headline !== null && headline !== selected && now - lastHeadline > HEADLINE_EVERY_MS
    if (opens) lastHeadline = now
    // [Agent] Play's own selections go straight to the store, not through select(), so they don't interrupt Play.
    store.setState({ ...next, ...(opens ? { selected: headline, camera: { index: headline, mode: 'glide' as const } } : {}) })
    playFrame = requestAnimationFrame(step)
  })
}

// [Agent] Outside a trip, the open event always lies inside the time window. Moving time off it closes it: scrubbing, a span button, an era tab, Play running past it. So a 2011 war can't linger over antiquity. A trip is exempt, because its window leaves the old event on purpose and the destination replaces it on arrival. Set up once at boot; returns the unsubscribe.
export function keepSelectionInTime(events: EventsData) {
  return store.subscribe(({ timeWindow: [start, end], selected, flight }, prev) => {
    if (selected === null || flight !== null || (prev.timeWindow[0] === start && prev.timeWindow[1] === end)) return
    if (events.start[selected] > end || events.end[selected] < start) store.setState({ selected: null })
  })
}

export function pause() {
  cancelAnimationFrame(playFrame)
  if (store.getState().playing) store.setState({ playing: false })
}

// [Agent] A user action takes over: stop both autoplays and cancel any trip in flight.
function interrupt() {
  stopFollowing()
  pause()
  flightId++
}

function hop(events: EventsData) {
  const from = store.getState().selected
  if (from === null) return stopFollowing()
  thread.add(from)
  const next = nextInStory(events, from, thread)
  if (next === null) return stopFollowing()
  fly(events, next, () => {
    if (store.getState().following) dwellTimer = window.setTimeout(() => hop(events), DWELL_MS)
  })
}

// [Agent] Time and space at once. The time window glides across the bar to the event's era, keeping its span, so the map re-inks itself through every age it passes, while the map flies over (camera mode 'travel'). The glide runs in bar position rather than years, so a trip from 1900 to 500 BC spends its time evenly across the ages instead of rushing through antiquity. During the flight the destination is `flight`, pinned so it's drawn the moment the camera lands. On arrival it becomes the selection.
function fly(events: EventsData, i: number, arrived?: () => void) {
  const id = ++flightId
  const { year, span } = store.getState()
  const from = yearToT(year)
  const to = yearToT(events.start[i])
  store.setState({ flight: i, camera: { index: i, mode: 'travel' } })

  const started = performance.now()
  requestAnimationFrame(function step(now) {
    // [Agent] A newer navigation cancels this one by bumping flightId.
    if (id !== flightId) return
    const t = Math.min(1, (now - started) / TRAVEL_MS)
    const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
    store.setState(momentAt(tToYear(from + (to - from) * eased), span))
    if (t < 1) return requestAnimationFrame(step)
    store.setState({ selected: i, flight: null })
    arrived?.()
  })
}
