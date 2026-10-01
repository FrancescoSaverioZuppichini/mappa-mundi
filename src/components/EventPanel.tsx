// [Agent] Responsibility: the open event's card: its Wikipedia lead with working links, rank in the span, related events, what happened next and the thread.

import { Fragment, type ReactNode, useEffect, useMemo, useState } from 'react'
import { DWELL_MS, YEAR_MAX } from '../consts'
import { events, useHistory } from '../hooks/useHistory'
import { CATEGORIES } from '../lib/categories'
import { rank } from '../lib/rank'
import { distanceKm, nextInStory } from '../lib/story'
import { formatYears, windowOf } from '../lib/time'
import type { Lead } from '../types'
import { ArrowIcon, CloseIcon, NextIcon, PlayIcon } from './icons'

// [Agent] Article title → event, to turn links to our own events into in-app links. Titles are compared with spaces, because links write them with underscores and the data sometimes doesn't.
const EVENT_BY_ARTICLE = new Map(events.article.map((article, i) => [article.replaceAll('_', ' '), i]))
const LEAD_PARAGRAPHS = 3

const RELATED = 5
const ELSEWHERE_KM = 800
const SAME_PLACE_KM = 150

export function EventPanel() {
  const selected = useHistory(s => s.selected)
  // [Agent] Keyed by event, so switching events remounts the card with a fresh, empty lead instead of briefly showing the previous one.
  return selected === null ? null : <EventCard key={selected} index={selected} />
}

function EventCard({ index }: { index: number }) {
  const lead = useLead(events.qid[index])
  const update = useHistory(s => s.update)
  // [Agent] Esc closes the card. The listener lives here, so it exists only while a card is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && update({ selected: null })
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [update])
  const time = useHistory(s => s.time)
  const hidden = useHistory(s => s.view.hidden)
  const category = CATEGORIES[events.category[index]]
  const color = category.color

  // [Agent] Two ways to keep exploring from here. "Meanwhile" is the rest of the world during the same years, which is where the learning happens. "Same place" is this spot's history across all eras. Both walk the in-degree-sorted events once and keep the first few matches, so they are already the most important ones.
  const { meanwhile, samePlace } = useMemo(() => {
    const km = (j: number) => distanceKm(events, index, j)
    // [Agent] Dating gets fuzzier the further back you go, so "the same years" widens with age: ±2 years for the 1940s, ±10 around 1066, ±25 in antiquity.
    const pad = Math.max(2, (YEAR_MAX - events.start[index]) * 0.01)
    const from = events.start[index] - pad
    const to = events.end[index] + pad
    const meanwhile: number[] = []
    const samePlace: number[] = []
    for (let j = 0; j < events.count; j++) {
      if (j === index) continue
      if (meanwhile.length < RELATED && events.start[j] <= to && events.end[j] >= from && km(j) > ELSEWHERE_KM) meanwhile.push(j)
      if (samePlace.length < RELATED && km(j) < SAME_PLACE_KM) samePlace.push(j)
    }
    samePlace.sort((a, b) => events.start[a] - events.start[b])
    return { meanwhile, samePlace }
  }, [index])
  // [Agent] Rank by share of the window, the same order the map and timeline use.
  const ranked = rank(events, windowOf(time), hidden)
  const position = ranked.indexOf(index)
  const topPercent = Math.max(0.1, (position / Math.max(1, ranked.length)) * 100)

  return (
    <aside className="absolute top-20 right-5 bottom-36 z-20 flex w-[24rem] max-w-[calc(100vw-2.5rem)] animate-panel-in flex-col overflow-hidden rounded-2xl bg-paper text-ink shadow-[0_24px_60px_-24px_rgba(0,0,0,0.55)] ring-[0.5px] ring-ink/15">
      <div className="relative h-44 shrink-0 overflow-hidden" style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 30%, var(--paper)))` }}>
        {lead?.thumbnail && <img src={lead.thumbnail} alt="" className="size-full object-cover" />}
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-paper to-transparent" />
        <button
          type="button"
          onClick={() => update({ selected: null })}
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
            {position >= 0 && <span className="opacity-50">top {topPercent < 1 ? topPercent.toFixed(1) : Math.round(topPercent)}% of this span</span>}
          </div>
          <div className="mt-1.5 h-px overflow-hidden bg-ink/10">
            <div className="h-full bg-accent transition-[width] duration-500" style={{ width: position >= 0 ? `${100 - Math.min(99, topPercent)}%` : 0 }} />
          </div>
        </div>

        {lead?.paragraphs.length ? (
          lead.paragraphs.map((paragraph, n) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the paragraphs of one article never reorder.
            <p key={n} className="mt-4 font-serif text-[15px] leading-[1.65] opacity-85">
              {inline(paragraph, j => update({ selected: j }))}
            </p>
          ))
        ) : (
          <p className="mt-4 font-serif text-[15px] leading-[1.65] opacity-85">{lead ? lead.description : '…'}</p>
        )}

        <div className="mt-3 flex gap-4 font-ui text-[12px] font-medium text-accent">
          <a href={`https://en.wikipedia.org/wiki/${encodeURIComponent(events.article[index])}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
            Read on Wikipedia <ArrowIcon />
          </a>
          <a href={`https://www.wikidata.org/wiki/${events.qid[index]}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 opacity-70 hover:underline">
            Wikidata <ArrowIcon />
          </a>
        </div>

        <Related title="Meanwhile, elsewhere" items={meanwhile} />
        <Related title="Same place, other eras" items={samePlace} />
      </div>
      <WhatNext index={index} />
    </aside>
  )
}

function Related({ title, items }: { title: string; items: number[] }) {
  const update = useHistory(s => s.update)
  if (!items.length) return null
  return (
    <section className="mt-6 border-t-[0.5px] border-ink/15 pt-4">
      <h3 className="mb-1.5 font-ui text-[10px] font-medium tracking-[0.2em] uppercase opacity-45">{title}</h3>
      <ul className="-mx-2">
        {items.map(j => (
          <li key={j}>
            <button type="button" onClick={() => update({ selected: j })} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left transition hover:bg-ink/5">
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

// [Agent] The panel's fixed footer: the story's next step (lib/story.ts) as a card that travels there, plus the thread autoplay. It stays in view however long the lead is, because it's the main way onward. While following, a hairline fills over the dwell time, so it's clear the map will move on by itself and when.
function WhatNext({ index }: { index: number }) {
  const update = useHistory(s => s.update)
  const next = useMemo(() => nextInStory(events, index, new Set()), [index])
  const following = useHistory(s => s.thread)
  if (next === null) return null

  const years = Math.round(events.start[next] - events.start[index])
  const km = Math.round(distanceKm(events, index, next))
  const when = years < 1 ? 'The same year' : `${years.toLocaleString()} year${years === 1 ? '' : 's'} later`
  const where = km < 50 ? 'same place' : `${km.toLocaleString()} km away`

  return (
    <footer className="relative shrink-0 border-t-[0.5px] border-ink/15 bg-paper px-5 pt-3 pb-4">
      <h3 className="mb-1 font-ui text-[10px] font-medium tracking-[0.2em] uppercase opacity-45">What happened next</h3>
      <button type="button" onClick={() => update({ selected: next })} className="group -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-ink/5">
        <span className="size-2 shrink-0 rounded-full" style={{ background: CATEGORIES[events.category[next]].color }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[16px] leading-snug">{events.label[next]}</span>
          <span className="block font-ui text-[11px] opacity-50">
            {when} · {where}
          </span>
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
            <button type="button" onClick={() => update({ selected: next, thread: true })} className="ml-auto opacity-55 transition hover:opacity-100">
              Next now
            </button>
            <button type="button" onClick={() => update({ thread: false })} className="opacity-55 transition hover:opacity-100">
              Stop
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => update({ thread: true })}
            className="press inline-flex items-center gap-1.5 rounded-full bg-accent py-1.5 pr-3.5 pl-2.5 font-medium text-paper hover:brightness-110"
          >
            <PlayIcon /> Follow the thread
          </button>
        )}
      </div>
      {following && (
        <div className="absolute inset-x-0 top-0 h-px overflow-hidden">
          <div key={index} className="h-full origin-left animate-dwell bg-accent" style={{ animationDuration: `${DWELL_MS}ms` }} />
        </div>
      )}
    </footer>
  )
}

// [Agent] The event's lead, description and thumbnail, one same-origin call. The lead arrives as clean HTML and is parsed only to be walked by inline(), never injected. A failed call still settles to an empty lead, so the card stops showing the ellipsis, and the console says why.
function useLead(qid: string) {
  const [lead, setLead] = useState<(Lead & { paragraphs: Element[] }) | null>(null)
  useEffect(() => {
    const abort = new AbortController()
    fetch(`/api/leads/${qid}`, { signal: abort.signal })
      .then(r => {
        if (!r.ok) throw new Error(`${r.url}: ${r.status}`)
        return r.json() as Promise<Lead>
      })
      .then(row => setLead({ ...row, paragraphs: [...new DOMParser().parseFromString(row.lead_html ?? '', 'text/html').body.children].slice(0, LEAD_PARAGRAPHS) }))
      .catch(err => {
        if (abort.signal.aborted) return
        console.error(err)
        setLead({ description: null, lead_html: null, thumbnail: null, paragraphs: [] })
      })
    return () => abort.abort()
  }, [qid])
  return lead
}

// [Agent] The cleaned lead → React: text, bold, italics and links, anything else unwrapped. Nothing is injected as HTML, so nothing from the page can run. A link to one of our events opens it in the app; any other link opens Wikipedia.
function inline(node: Node, open: (event: number) => void, key = 0): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent
  if (!(node instanceof Element)) return null
  const children = [...node.childNodes].map((child, i) => inline(child, open, i))
  if (node.tagName === 'B') return <b key={key}>{children}</b>
  if (node.tagName === 'I') return <i key={key}>{children}</i>
  const href = node.tagName === 'A' ? node.getAttribute('href') : null
  if (href?.startsWith('/wiki/')) {
    const event = EVENT_BY_ARTICLE.get(decodeURIComponent(href.slice(6).split('#')[0]).replaceAll('_', ' '))
    return event === undefined ? (
      <a key={key} href={`https://en.wikipedia.org${href}`} target="_blank" rel="noreferrer" className="underline decoration-ink/25 underline-offset-2 hover:decoration-ink/60">
        {children}
      </a>
    ) : (
      <button key={key} type="button" onClick={() => open(event)} title="Open on the map" className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
        {children}
      </button>
    )
  }
  return <Fragment key={key}>{children}</Fragment>
}
