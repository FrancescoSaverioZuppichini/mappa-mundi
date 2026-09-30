// [Agent] Responsibility: the one-shot ripple when the camera lands on an event.

import type { Map as MapLibreMap } from 'maplibre-gl'

// [Agent] A one-shot ripple on an event: an `arrival` level runs 0→1 in the feature state, and the style draws it as a ring that grows and fades. Used when the time machine lands.
const DURATION_MS = 1400

export function createPulse(map: MapLibreMap) {
  let frame = 0

  function play(id: number) {
    cancelAnimationFrame(frame)
    const started = performance.now()
    frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - started) / DURATION_MS)
      map.setFeatureState({ source: 'events', id }, { arrival: t < 1 ? 1 - (1 - t) ** 3 : 0 })
      if (t < 1) frame = requestAnimationFrame(step)
    })
  }

  return { play, destroy: () => cancelAnimationFrame(frame) }
}
