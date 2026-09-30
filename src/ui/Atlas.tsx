import { useEffect, useRef } from 'react'
import { createAtlas } from '../map/atlas'
import type { EventsData } from '../model/events'

// [Agent] Mounts the imperative map. React only owns the element; createAtlas owns everything inside it and returns its own cleanup.
export function Atlas({ events }: { events: EventsData }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => createAtlas(ref.current!, events), [events])
  // [Agent] MapLibre's own CSS forces `position: relative` on the map element, and unlayered CSS beats Tailwind's layered utilities. So the positioning lives on a wrapper and the map element only fills it.
  return (
    <div className="absolute inset-0">
      <div ref={ref} className="size-full" />
    </div>
  )
}
