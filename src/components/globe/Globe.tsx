// [Agent] Responsibility: mount the globe (map.ts) into the page, and own its hover state, which feeds the Tooltip.

import { useEffect, useRef, useState } from 'react'
import type { HoveredEvent } from '../../types'
import { createMap } from './map'
import { Tooltip } from './Tooltip'

// [Agent] Mounts the imperative globe. React only owns the element and the hover, which is local to the globe: the tooltip is its child, not app state.
export function Globe() {
  const ref = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<HoveredEvent>(null)
  useEffect(() => createMap(ref.current!, setHovered), [])
  // [Agent] MapLibre's own CSS forces `position: relative` on the map element, and unlayered CSS beats Tailwind's layered utilities. So the positioning lives on a wrapper and the map element only fills it.
  return (
    <>
      <div className="absolute inset-0">
        <div ref={ref} className="size-full" />
      </div>
      <Tooltip hovered={hovered} />
    </>
  )
}
