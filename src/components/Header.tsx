// [Agent] Responsibility: the top of the page: era and years, span buttons, the Detail slider and counts, and the toolbar (Surprise, Categories, tour, globe/map).

import { SPANS } from '../consts'
import { useHistory } from '../hooks/useHistory'
import { epochAt } from '../lib/epochs'
import { formatYears, windowOf } from '../lib/time'
import { CategoryMenu } from './CategoryMenu'
import { GlobeIcon, MapIcon } from './icons'
import { Surprise } from './Surprise'

// [Agent] The era title sits straight on the dark space around the globe, with no card: the page reads like the opening spread of an atlas. Span and Detail live right under it, because how many years and how many events are both part of "what am I looking at".
export function Header() {
  // [Agent] One of the EPOCHS objects, so the header re-renders only when the era changes.
  const epoch = useHistory(s => epochAt(s.time.year))
  const time = useHistory(s => s.time)
  const { detail, projection } = useHistory(s => s.view)
  const lod = useHistory(s => s.drawn)
  const update = useHistory(s => s.update)

  return (
    <>
      <header className="absolute top-6 left-7 z-10 max-w-[min(34rem,calc(100vw-10rem))] text-on-space max-sm:top-5 max-sm:left-5">
        <div className="font-ui text-[10px] font-medium tracking-[0.32em] text-highlight uppercase">{epoch.name}</div>
        <h1 className="mt-1 font-display text-[clamp(1.6rem,4.2vw,3.4rem)] leading-[0.95] tracking-tight">{formatYears(...windowOf(time))}</h1>
        <fieldset data-tour="span" aria-label="Span in years" className="mt-4 flex w-fit items-center gap-0.5 font-ui text-[11px]">
          <span className="mr-2.5 tracking-wide opacity-50">Span</span>
          {SPANS.map(span => {
            const active = Math.round(time.span) === span
            return (
              <button
                type="button"
                key={span}
                onClick={() => update({ time: { span } })}
                aria-pressed={active}
                className={`press rounded-full px-2 py-0.5 tabular-nums ${active ? 'bg-highlight font-medium text-space' : 'opacity-60 hover:bg-on-space/10 hover:opacity-100'}`}
              >
                {span}
              </button>
            )
          })}
          <span className="ml-1.5 opacity-50">{Math.round(time.span) === 1 ? 'year' : 'years'}</span>
        </fieldset>
        <div data-tour="detail" className="mt-2 flex w-fit items-center gap-3 font-ui text-[11px]">
          <label htmlFor="detail" className="tracking-wide opacity-50">
            Detail
          </label>
          <input id="detail" type="range" min={0} max={1} step={0.01} value={detail} onChange={e => update({ view: { detail: Number(e.target.value) } })} className="hairline w-32" />
          <span className="tabular-nums opacity-70" title="Minimum in-degree shown: English Wikipedia articles linking to the event">
            ≥ {lod.minInlinks.toLocaleString()} links
          </span>
        </div>
        <div className="mt-1 font-ui text-[11px] opacity-40">
          {lod.shown.toLocaleString()} of {lod.population.toLocaleString()} events in this span
          {lod.shown < lod.population && ' · zoom in or narrow the span for more'}
        </div>
      </header>
      <div className="absolute top-6 right-6 z-20 flex gap-1.5 max-sm:top-5 max-sm:right-4">
        <Surprise />
        <CategoryMenu />
        <button
          type="button"
          onClick={() =>
            update({
              selected: null,
              tour: true,
              view: { projection: 'globe' },
            })
          }
          aria-label="Show the introduction"
          title="How it works"
          className="glass press grid size-9 place-items-center rounded-full font-ui text-[13px] hover:bg-on-space/10"
        >
          ?
        </button>
        <button
          type="button"
          onClick={() =>
            update({
              view: {
                projection: projection === 'globe' ? 'mercator' : 'globe',
              },
            })
          }
          aria-label={projection === 'globe' ? 'Switch to flat map' : 'Switch to globe'}
          title={projection === 'globe' ? 'Flat map' : 'Globe'}
          className="glass press grid size-9 place-items-center rounded-full hover:bg-on-space/10"
        >
          {projection === 'globe' ? <MapIcon /> : <GlobeIcon />}
        </button>
      </div>
    </>
  )
}
