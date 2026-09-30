// [Agent] Responsibility: keep the border layer on the historical snapshot at or before the playhead year.

import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'

// [Agent] Keeps the 'polities' source on the historical border snapshot at or before the focus year. It knows nothing about the store: the atlas tells it which year to show.
export function createBorders(map: MapLibreMap) {
  let snapshots: number[] = []
  let shown: number | null = null
  let wanted: number | null = null
  let timer = 0
  const loading = new AbortController()

  // [Agent] Aborted on teardown: under StrictMode's double mount, the first map is removed before this lands and must not be touched afterwards.
  fetch('/geo/borders/index.json', { signal: loading.signal })
    .then(r => r.json())
    .then((years: number[]) => {
      snapshots = years
      if (wanted !== null) show(wanted)
    })
    .catch(() => {})

  function show(year: number) {
    wanted = year
    const snapshot = snapshots.findLast(y => y <= year) ?? snapshots[0]
    if (snapshot === undefined || snapshot === shown) return
    shown = snapshot
    // [Agent] Debounced so scrubbing across ten snapshots only loads the one the scrub stops on. setData with a URL lets MapLibre's worker fetch and parse it off the main thread.
    clearTimeout(timer)
    timer = window.setTimeout(() => (map.getSource('polities') as GeoJSONSource).setData(`/geo/borders/${snapshot}.json`), 120)
  }

  function destroy() {
    loading.abort()
    clearTimeout(timer)
  }

  return { show, destroy }
}
