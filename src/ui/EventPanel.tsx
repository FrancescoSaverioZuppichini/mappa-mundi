import { useEffect, useMemo, useState } from 'react'
import { useStore } from 'zustand'
import { CATEGORIES } from '../model/categories'
import type { EventsData } from '../model/events'
import { rankWindow } from '../model/rank'
import { distanceKm, nextInStory } from '../model/story'
import { formatYears, YEAR_MAX } from '../model/time'
import { DWELL_MS, focus, follow, followNow, select, stopFollowing, travelTo } from '../state/navigation'
import { store } from '../state/store'
import { ArrowIcon, CloseIcon, NextIcon, PlayIcon } from './icons'

type Summary = { extract: string; thumbnail?: { source: string }; content_urls: { desktop: { page: string } } }

const RELATED = 5
const ELSEWHERE_KM = 800
const SAME_PLACE_KM = 150

export function EventPanel({ events }: { events: EventsData }) {
  const selected = useStore(store, s => s.selected)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && store.getState().selected !== null && select(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // [Agent] Keyed by event, so switching events remounts the card with a fresh, empty summary instead of briefly showing the previous one.
  return selected === null ? null : <EventCard key={selected} events={events} index={selected} />
}

function EventCard({ events, index }: { events: EventsData; index: number }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const timeWindow = useStore(store, s => s.timeWindow)
  const category = CATEGORIES[events.category[index]]
  const color = category.color

  useEffect(() => {
    const abort = new AbortController()
    fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(events.article[index])}`, { signal: abort.signal })
      .then(r => (r.ok ? r.json() : null))
      .then(setSummary)
      .catch(() => {})
    return () => abort.abort()
  }, [events, index])

  // [Agent] Two ways to keep exploring from here. "Meanwhile" is the rest of the world during the same years, which is where the learning happens. "Same place" is this spot's history across all eras. Both walk the in-degree-sorted events once and keep the first few matches, so they are already the most important ones.
  const hiddenCategories = useStore(store, s => s.hiddenCategories)
  const { rank, population, meanwhile, samePlace } = useMemo(() => {
    const lon0 = events.positions[index * 2]
    const lat0 = events.positions[index * 2 + 1]
    const cosLat = Math.cos((lat0 * Math.PI) / 180)
    const km = (j: number) => {
      const dLon = ((events.positions[j * 2] - lon0 + 540) % 360) - 180
      return Math.hypot(dLon * cosLat * 111.3, (events.positions[j * 2 + 1] - lat0) * 110.6)
    }
    // [Agent] Dating gets fuzzier the further back you go, so "the same years" widens with age: ±2 years for the 1940s, ±10 around 1066, ±25 in antiquity.
    const pad = Math.max(2, (YEAR_MAX - events.start[index]) * 0.01)
    const from = events.start[index] - pad
    const to = events.end[index] + pad
    const meanwhile: number[] = []
    const samePlace: number[] = []
    // [Agent] Rank by share of the window, the same order the map and timeline use. -1 when the event is outside the window, as when Play has moved on past it.
    const ranked = rankWindow(events, timeWindow, hiddenCategories)
    const population = ranked.length
    const rank = ranked.indexOf(index)
    for (let j = 0; j < events.count; j++) {
      if (j === index) continue
      if (meanwhile.length < RELATED && events.start[j] <= to && events.end[j] >= from && km(j) > ELSEWHERE_KM) meanwhile.push(j)
      if (samePlace.length < RELATED && km(j) < SAME_PLACE_KM) samePlace.push(j)
    }
    samePlace.sort((a, b) => events.start[a] - events.start[b])
    return { rank, population, meanwhile, samePlace }
  }, [events, index, timeWindow, hiddenCategories])
  const topPercent = Math.max(0.1, (rank / Math.max(1, population)) * 100)

  return (
    <aside className="absolute top-20 right-5 bottom-36 z-20 flex w-[24rem] max-w-[calc(100vw-2.5rem)] animate-panel-in flex-col overflow-hidden rounded-2xl bg-paper text-ink shadow-[0_24px_60px_-24px_rgba(0,0,0,0.55)] ring-[0.5px] ring-ink/15">
      <div className="relative h-44 shrink-0 overflow-hidden" style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 30%, var(--paper)))` }}>
        {summary?.thumbnail && <img src={summary.thumbnail.source} alt="" className="size-full object-cover" />}
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-paper to-transparent" />
        <button
          onClick={() => select(null)}
          aria-label="Close"
          className="press absolute top-2.5 right-2.5 grid size-8 place-items-center rounded-full bg-paper/80 backdrop-blur hover:bg-paper"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="-mt-5 flex-1 overflow-y-auto px-5 pb-5">
        <div className="relative flex items-center gap-2 font-ui text-[10px] font-medium tracking-[0.2em] uppercase">
          <span className="size-2 rounded-full" style={{ background: color }} />
          <span className="opacity-60">{category.name}</span>
          <span className="opacity-30">·</span>
          <span className="opacity-60">{formatYears(events.start[index], events.end[index])}</span>
        </div>
        <h2 className="mt-1.5 font-display text-[1.65rem] leading-[1.08] tracking-tight">{events.label[index]}</h2>

        <div className="mt-4 font-ui">
          <div className="flex items-baseline justify-between text-[11px]">
            <span>
              <span className="text-[13px] font-medium tabular-nums">{events.inlinks[index].toLocaleString()}</span>
              <span className="opacity-50"> articles link here</span>
            </span>
            {rank >= 0 && <span className="opacity-50">top {topPercent < 1 ? topPercent.toFixed(1) : Math.round(topPercent)}% of this span</span>}
          </div>
          <div className="mt-1.5 h-px overflow-hidden bg-ink/10">
            <div className="h-full bg-accent transition-[width] duration-500" style={{ width: rank >= 0 ? `${100 - Math.min(99, topPercent)}%` : 0 }} />
          </div>
        </div>

        <p className="mt-4 font-serif text-[15px] leading-[1.65] opacity-85">{summary?.extract ?? '…'}</p>

        <div className="mt-3 flex gap-4 font-ui text-[12px] font-medium text-accent">
          {summary && (
            <a href={summary.content_urls.desktop.page} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
              Read on Wikipedia <ArrowIcon />
            </a>
          )}
          <a href={`https://www.wikidata.org/wiki/Q${events.qid[index]}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 opacity-70 hover:underline">
            Wikidata <ArrowIcon />
          </a>
        </div>

        <Related title="Meanwhile, elsewhere" events={events} items={meanwhile} />
        <Related title="Same place, other eras" events={events} items={samePlace} />
      </div>
      <WhatNext events={events} index={index} />
    </aside>
  )
}

function Related({ title, events, items }: { title: string; events: EventsData; items: number[] }) {
  if (!items.length) return null
  return (
    <section className="mt-6 border-t-[0.5px] border-ink/15 pt-4">
      <h3 className="mb-1.5 font-ui text-[10px] font-medium tracking-[0.2em] uppercase opacity-45">{title}</h3>
      <ul className="-mx-2">
        {items.map(j => (
          <li key={j}>
            <button onClick={() => focus(events, j)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left transition hover:bg-ink/5">
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: CATEGORIES[events.category[j]].color }} />
              <span className="min-w-0 flex-1 truncate font-display text-[14px]">{events.label[j]}</span>
              <span className="shrink-0 font-ui text-[11px] tabular-nums opacity-45">{formatYears(events.start[j], events.end[j])}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

// [Agent] The panel's fixed footer: the story's next step (model/story.ts) as a card that travels there, plus the thread autoplay. It stays in view however long the summary is, because it's the main way onward. While following, a hairline fills over the dwell time, so it's clear the map will move on by itself and when.
function WhatNext({ events, index }: { events: EventsData; index: number }) {
  const next = useMemo(() => nextInStory(events, index, new Set()), [events, index])
  const following = useStore(store, s => s.following)
  const flying = useStore(store, s => s.flight !== null)
  if (next === null) return null

  const years = Math.round(events.start[next] - events.start[index])
  const km = Math.round(distanceKm(events, index, next))
  const when = years < 1 ? 'The same year' : `${years.toLocaleString()} year${years === 1 ? '' : 's'} later`
  const where = km < 50 ? 'same place' : `${km.toLocaleString()} km away`

  return (
    <footer className="relative shrink-0 border-t-[0.5px] border-ink/15 bg-paper px-5 pt-3 pb-4">
      <h3 className="mb-1 font-ui text-[10px] font-medium tracking-[0.2em] uppercase opacity-45">What happened next</h3>
      <button onClick={() => travelTo(events, next)} className="group -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-ink/5">
        <span className="size-2 shrink-0 rounded-full" style={{ background: CATEGORIES[events.category[next]].color }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[16px] leading-snug">{events.label[next]}</span>
          <span className="block font-ui text-[11px] opacity-50">{when} · {where}</span>
        </span>
        <span className="opacity-35 transition group-hover:translate-x-0.5 group-hover:opacity-80">
          <NextIcon />
        </span>
      </button>
      <div className="mt-2 flex items-center gap-3 font-ui text-[12px]">
        {following ? (
          <>
            <span className="flex items-center gap-1.5 font-medium text-accent">
              <span className="size-1.5 animate-pulse rounded-full bg-accent" />
              Following the thread
            </span>
            <button onClick={() => followNow(events)} className="ml-auto opacity-55 transition hover:opacity-100">Next now</button>
            <button onClick={stopFollowing} className="opacity-55 transition hover:opacity-100">Stop</button>
          </>
        ) : (
          <button onClick={() => follow(events)} className="press inline-flex items-center gap-1.5 rounded-full bg-accent py-1.5 pr-3.5 pl-2.5 font-medium text-paper hover:brightness-110">
            <PlayIcon /> Follow the thread
          </button>
        )}
      </div>
      {following && !flying && (
        <div className="absolute inset-x-0 top-0 h-px overflow-hidden">
          <div key={index} className="h-full origin-left animate-dwell bg-accent" style={{ animationDuration: `${DWELL_MS}ms` }} />
        </div>
      )}
    </footer>
  )
}
