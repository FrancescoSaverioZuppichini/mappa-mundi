import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES } from '../model/categories'
import type { EventsData } from '../model/events'
import { focus } from '../state/navigation'
import { formatYears } from '../model/time'
import { SearchIcon } from './icons'

const MAX_RESULTS = 8

export function Search({ events }: { events: EventsData }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const lowercase = useMemo(() => events.label.map(l => l.toLowerCase()), [events])

  // [Agent] Events are sorted by in-degree, so the first substring matches are already the most important ones. The scan stops after MAX_RESULTS hits, which makes a linear pass instant.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hits: number[] = []
    if (q.length < 2) return hits
    for (let i = 0; i < events.count && hits.length < MAX_RESULTS; i++) if (lowercase[i].includes(q)) hits.push(i)
    return hits
  }, [query, lowercase, events])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && document.activeElement?.tagName !== 'INPUT')) {
        e.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function choose(i: number) {
    focus(events, i)
    setQuery('')
    input.current?.blur()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') setActive(a => Math.min(a + 1, results.length - 1))
    else if (e.key === 'ArrowUp') setActive(a => Math.max(a - 1, 0))
    else if (e.key === 'Enter' && results[active] !== undefined) choose(results[active])
    else if (e.key === 'Escape') input.current?.blur()
    else return
    e.preventDefault()
  }

  return (
    <div className="absolute top-6 left-1/2 z-20 w-[min(24rem,calc(100vw-3rem))] -translate-x-1/2 font-ui max-lg:top-auto max-lg:bottom-36">
      <label data-tour="search" className="glass flex h-9 items-center gap-2.5 rounded-full px-3.5 transition focus-within:shadow-[inset_0_0_0_1px_var(--highlight)]">
        <span className="opacity-45">
          <SearchIcon />
        </span>
        <input
          ref={input}
          value={query}
          role="combobox"
          aria-label="Search events"
          aria-expanded={results.length > 0}
          aria-controls="search-results"
          aria-activedescendant={results.length ? `search-result-${active}` : undefined}
          onChange={e => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Search battles, treaties, cities…"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-on-space/40"
        />
        <kbd aria-hidden className="rounded border-[0.5px] border-on-space/25 px-1.5 text-[10px] opacity-45">/</kbd>
      </label>
      {results.length > 0 && (
        <ul id="search-results" role="listbox" className="glass mt-2 origin-top animate-pop-in overflow-hidden rounded-xl p-1">
          {results.map((i, n) => (
            <li key={i} id={`search-result-${n}`} role="option" aria-selected={n === active}>
              <button
                tabIndex={-1}
                onMouseDown={e => e.preventDefault()}
                onClick={() => choose(i)}
                onMouseEnter={() => setActive(n)}
                className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition ${n === active ? 'bg-on-space/10' : ''}`}
              >
                <span className="size-2 shrink-0 rounded-full" style={{ background: CATEGORIES[events.category[i]].color }} />
                <span className="min-w-0 flex-1 truncate font-display text-[14px]">{events.label[i]}</span>
                <span className="shrink-0 text-[11px] tabular-nums opacity-45">{formatYears(events.start[i], events.end[i])}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
