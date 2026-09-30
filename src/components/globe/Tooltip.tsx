// [Agent] Responsibility: the small card that follows the pointer over a bubble.

import { events, useHistory } from '../../hooks/useHistory'
import { CATEGORIES } from '../../lib/categories'
import { formatYears } from '../../lib/time'
import type { HoveredEvent } from '../../types'

export function Tooltip({ hovered }: { hovered: HoveredEvent }) {
  const selected = useHistory(s => s.selected)
  if (!hovered || hovered.index === selected) return null
  const i = hovered.index
  const category = CATEGORIES[events.category[i]]
  return (
    // [Agent] Keyed by event, so moving to another bubble pops the card in again instead of silently swapping its text.
    <div
      key={i}
      className="pointer-events-none absolute z-30 max-w-72 origin-top-left animate-pop-in rounded-xl bg-paper/95 px-3 py-2 text-ink shadow-[0_12px_32px_-12px_rgba(0,0,0,0.5)] ring-[0.5px] ring-ink/15 backdrop-blur-xl"
      style={{ left: hovered.x + 14, top: hovered.y + 14 }}
    >
      <div className="flex items-center gap-1.5 font-ui text-[10px] font-medium tracking-[0.16em] uppercase opacity-60">
        <span className="size-1.5 rounded-full" style={{ background: category.color }} />
        {category.name} · {formatYears(events.start[i], events.end[i])}
      </div>
      <div className="mt-0.5 font-display text-[15px] leading-snug">{events.label[i]}</div>
      <div className="mt-0.5 font-ui text-[11px] opacity-50">{events.inlinks[i].toLocaleString()} articles link here · click to open</div>
    </div>
  )
}
