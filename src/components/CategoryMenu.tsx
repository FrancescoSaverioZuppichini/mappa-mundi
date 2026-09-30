// [Agent] Responsibility: switch categories on and off (view.hidden), with their counts in the current window.

import { useEffect, useRef, useState } from 'react'
import { events, useHistory } from '../hooks/useHistory'
import { CATEGORIES } from '../lib/categories'
import { windowOf } from '../lib/time'
import { LayersIcon } from './icons'

export function CategoryMenu() {
  const [open, setOpen] = useState(false)
  const hidden = useHistory(s => s.view.hidden)
  const update = useHistory(s => s.update)
  const time = useHistory(s => s.time)
  const root = useRef<HTMLDivElement>(null)

  // [Agent] Close on a click outside the menu or on Esc.
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // [Agent] Counts only matter while the menu is open, so the linear pass over all events runs only then.
  const counts = new Array(CATEGORIES.length).fill(0)
  const [start, end] = windowOf(time)
  if (open) for (let i = 0; i < events.count; i++) if (events.start[i] <= end && events.end[i] >= start) counts[events.category[i]]++

  const toggle = (c: number) => update({ view: { hidden: hidden.includes(c) ? hidden.filter(h => h !== c) : [...hidden, c] } })
  const only = (c: number) => update({ view: { hidden: CATEGORIES.map((_, i) => i).filter(i => i !== c) } })

  return (
    <div ref={root} className="relative font-ui">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label="Categories"
        className="glass press flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] hover:bg-on-space/10 max-sm:px-2.5"
      >
        <LayersIcon />
        <span className="max-sm:hidden">Categories</span>
        {hidden.length > 0 && (
          <span className="text-[11px] text-highlight tabular-nums">
            {CATEGORIES.length - hidden.length}/{CATEGORIES.length}
          </span>
        )}
      </button>
      {open && (
        <div className="glass absolute top-full right-0 mt-2 w-64 max-w-[calc(100vw-2rem)] origin-top-right animate-pop-in rounded-xl p-1.5">
          {CATEGORIES.map((c, i) => {
            const off = hidden.includes(i)
            return (
              <div key={c.name} className="group flex items-center rounded-lg transition hover:bg-on-space/[0.07]">
                <button type="button" onClick={() => toggle(i)} aria-pressed={!off} className="flex flex-1 items-center gap-2.5 px-2.5 py-1.5 text-left text-[13px] capitalize">
                  <span aria-hidden className="size-2.5 rounded-full transition" style={{ background: off ? 'transparent' : c.color, boxShadow: `inset 0 0 0 1px ${c.color}` }} />
                  <span className={`flex-1 transition ${off ? 'opacity-35' : ''}`}>{c.name}</span>
                  <span className="text-[11px] tabular-nums opacity-40">{counts[i].toLocaleString()}</span>
                </button>
                {/* [Agent] "only" appears on hover, on keyboard focus, and always on touch screens, which can't hover. */}
                <button
                  type="button"
                  onClick={() => only(i)}
                  aria-label={`Show only ${c.name}`}
                  className="mr-1.5 rounded px-1.5 py-0.5 text-[11px] text-highlight opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  only
                </button>
              </div>
            )
          })}
          <div className="mt-1 border-t-[0.5px] border-on-space/15 pt-1">
            <button type="button" onClick={() => update({ view: { hidden: [] } })} className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] text-highlight transition hover:bg-on-space/[0.07]">
              Show all categories
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
