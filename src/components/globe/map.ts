// [Agent] Responsibility: the globe engine. Owns the MapLibre map: draws the state (bubbles, labels, borders, the era's look), re-runs placement as the camera moves, and moves the camera when `selected` changes. Not React: it reads the store and writes through update().

import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { events, useHistory } from '../../hooks/useHistory'
import { epochAt } from '../../lib/epochs'
import { rank } from '../../lib/rank'
import { windowOf } from '../../lib/time'
import type { HoveredEvent } from '../../types'
import { createBorders } from './borders'
import { createHover } from './hover'
import { type Previous, placeEvents, truncateLabel } from './placement'
import { createPulse } from './pulse'
import { applyEpoch, createStyle, FADE_MS, hideInactive } from './style'
import { textureImage } from './textures'
import { viewportOf } from './viewport'

// [Agent] MapLibre 6 finds its worker relative to its own module URL, which stops pointing anywhere once Vite pre-bundles the package. Having Vite bundle the worker itself gives a URL that works in dev and in the production build.
maplibregl.setWorkerUrl(workerUrl)

// [Agent] Placement re-runs while the camera moves, at most this often. MapLibre keeps moving the placed bubbles every frame in between, so motion stays at 60fps.
const PLACE_THROTTLE_MS = 120
const PANEL_WIDTH = 440
// [Agent] Flying to an event lands at regional scale: close enough to read its surroundings, and it opens placement's pool so the local story fills in around it.
const ARRIVAL_ZOOM = 4
// [Agent] While playing, the camera leans in only slightly past the home view, enough to feel it following the story without losing the world around it.
const GLIDE_ZOOM = 2.5

// [Agent] The globe. It reads the state and draws it; a click on a bubble goes back through update(). The camera isn't state: it follows `selected`, flying to a newly opened event unless it's already in view, and gliding during Play. Hover stays local and goes to the parent (the tooltip). Returns the cleanup, which is what React's useEffect wants.
export function createMap(container: HTMLElement, onHover: (hovered: HoveredEvent) => void) {
  // [Agent] Not a component, so it reads and writes the store directly rather than through the hook.
  const { update } = useHistory.getState()
  let epoch = epochAt(useHistory.getState().time.year)
  let styleReady = false
  let placeTimer = 0
  let lastPlaced = 0
  let hideTimer = 0
  // [Agent] The last placement, fed back so events already on screen hold their spot while the camera pans. It resets on a real zoom step or a filter change, which should re-rank from scratch.
  let previous: Previous | null = null
  let previousZoom = 0

  const map = new maplibregl.Map({
    container,
    style: createStyle(epoch),
    center: [-25, 18],
    zoom: 0.9,
    minZoom: 0.6,
    maxZoom: 12,
    attributionControl: { compact: true },
  })
  map.setMissingStyleImageResolver(id => {
    const image = textureImage(id)
    if (image) map.addImage(id, image, { pixelRatio: 2 })
  })
  const borders = createBorders(map)
  const pulse = createPulse(map)
  const hover = createHover(map, hovered => onHover(hovered && { index: hovered.index, x: hovered.point.x, y: hovered.point.y }))

  function place() {
    placeTimer = 0
    lastPlaced = performance.now()
    if (!styleReady) return
    const { time, view, selected } = useHistory.getState()
    const next = epochAt(time.year)
    if (next !== epoch) {
      epoch = next
      applyEpoch(map, epoch)
      clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => hideInactive(map, epoch), FADE_MS + 50)
    }
    borders.show(time.year)

    if (Math.abs(map.getZoom() - previousZoom) > 0.25) previous = null
    const viewport = viewportOf(map, view.projection === 'globe')
    const ranked = rank(events, windowOf(time), view.hidden)
    const { placed, lod } = placeEvents(events, viewport, { ranked, pinned: selected === null ? [] : [selected], detail: view.detail, font: epoch.font }, previous)
    const current = new Map(placed.map(p => [p.index, { anchor: p.anchor, tier: p.tier }]))
    previous = current
    previousZoom = viewport.zoom
    hover.keepIf(id => current.has(id))
    ;(map.getSource('events') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: placed.map(p => ({
        type: 'Feature',
        properties: {
          id: p.index,
          category: events.category[p.index],
          name: truncateLabel(events.label[p.index]),
          when: p.when,
          radius: p.radius,
          size: p.size,
          anchor: p.anchor,
          // [Agent] text-offset is in ems of the label's own size, so the gap is the bubble radius plus 5px, divided by the size. The sign follows the side the label sits on.
          offset: [((p.anchor === 'left' ? 1 : -1) * (p.radius + 5)) / p.size, 0],
          selected: p.index === selected,
          labeled: p.labeled,
          headline: p.headline,
        },
        geometry: { type: 'Point', coordinates: [events.lon[p.index], events.lat[p.index]] },
      })),
    })
    update({ drawn: lod })
  }

  // [Agent] Leading and trailing throttle: the first change places right away, a burst of changes places at most every PLACE_THROTTLE_MS, and the last change always gets its own pass.
  function schedulePlace() {
    if (placeTimer) return
    placeTimer = window.setTimeout(place, Math.max(0, PLACE_THROTTLE_MS - (performance.now() - lastPlaced)))
  }

  // [Agent] The home view: the whole globe, settled on the Old World. Globe zoom is absolute pixels, so the zoom scales with the viewport's short side and the globe fills a phone the way it fills a desktop. Padding is cleared too, in case the event panel had shifted the camera.
  function home(duration: number) {
    const fit = 1.8 + Math.log2(Math.min(container.clientWidth, container.clientHeight) / 820)
    map.easeTo({ center: [18, 32], zoom: Math.max(0.8, Math.min(2.2, fit)), padding: { top: 0, right: 0, bottom: 0, left: 0 }, duration, easing: t => 1 - (1 - t) ** 3 })
  }

  // [Agent] The event panel covers the right edge on wide screens, so while it's open the camera pads that space out and the globe re-centres in what's left.
  const panelPadding = (open: boolean) => ({ top: 0, bottom: 0, left: 0, right: open && container.clientWidth > 900 ? PANEL_WIDTH : 0 })
  const lngLatOf = (i: number): [number, number] => [events.lon[i], events.lat[i]]

  // [Agent] A newly opened event: if it's already in view beside the panel, only the padding eases. Otherwise the camera flies a high arc down to it, already padded for the panel, and a ripple marks the landing. The fly-to carries the padding itself, because two camera calls in a row cancel each other in MapLibre.
  function reveal(index: number) {
    const padding = panelPadding(true)
    const at = viewportOf(map, useHistory.getState().view.projection === 'globe').locate(...lngLatOf(index))
    if (at && at.x < container.clientWidth - padding.right) return map.easeTo({ padding, duration: 700 })
    map.flyTo({ center: lngLatOf(index), zoom: Math.max(map.getZoom(), ARRIVAL_ZOOM), padding, curve: 1.7, duration: 2200, essential: true })
    map.once('moveend', () => useHistory.getState().selected === index && pulse.play(index))
  }

  // [Agent] Play's drift toward the headline of the moment: a slow ease that never zooms out if you're already closer, and keeps the panel's padding.
  function glide(index: number) {
    map.easeTo({ center: lngLatOf(index), zoom: Math.max(map.getZoom(), GLIDE_ZOOM), padding: panelPadding(true), duration: 2400, easing: t => t * t * (3 - 2 * t) })
  }

  map.once('style.load', () => {
    styleReady = true
    place()
    // [Agent] The opening shot: the globe drifts in from afar and lands softly on the home view. A shared link to an event goes straight to that event instead.
    const { selected } = useHistory.getState()
    if (selected === null) home(2800)
    else reveal(selected)
  })
  map.on('move', schedulePlace)
  map.on('click', e => {
    const hit = map.queryRenderedFeatures(e.point, { layers: ['event-bubbles', 'event-labels'] })[0]
    update({ selected: hit ? Number(hit.id) : null })
  })

  const unsubscribe = useHistory.subscribe((s, prev) => {
    if (s.view.hidden !== prev.view.hidden || s.view.detail !== prev.view.detail) previous = null
    if (s.time !== prev.time || s.view !== prev.view || s.selected !== prev.selected) schedulePlace()
    if (s.view.projection !== prev.view.projection) map.setProjection({ type: s.view.projection })
    // [Agent] Camera, at most one call per change. The tour's first spotlight rings the globe at its home view, so opening the tour wins. Then a newly opened event, and otherwise the panel closing, which only eases the padding away.
    if (s.tour && !prev.tour) home(1400)
    else if (s.selected !== null && s.selected !== prev.selected) (s.play.on ? glide : reveal)(s.selected)
    else if (s.selected === null && prev.selected !== null) map.easeTo({ padding: panelPadding(false), duration: 700 })
  })

  return () => {
    unsubscribe()
    borders.destroy()
    hover.destroy()
    pulse.destroy()
    clearTimeout(placeTimer)
    clearTimeout(hideTimer)
    map.remove()
  }
}
