import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { epochAt } from '../model/epochs'
import type { EventsData } from '../model/events'
import { rankWindow } from '../model/rank'
import type { TimeWindow } from '../model/time'
import { select } from '../state/navigation'
import { store } from '../state/store'
import { createBorders } from './borders'
import { createHover } from './hover'
import { placeEvents, truncateLabel, type Previous } from './placement'
import { createPulse } from './pulse'
import { applyEpoch, createStyle, FADE_MS, hideInactive } from './style'
import { textureImage } from './textures'
import { viewportOf } from './viewport'

// [Agent] MapLibre 6 finds its worker relative to its own module URL, which stops pointing anywhere once Vite pre-bundles the package. Having Vite bundle the worker itself gives a URL that works in dev and in the production build.
maplibregl.setWorkerUrl(workerUrl)

// [Agent] Placement re-runs while the camera moves, at most this often. MapLibre keeps moving the placed bubbles every frame in between, so motion stays at 60fps.
const PLACE_THROTTLE_MS = 120
const PANEL_WIDTH = 440
// [Agent] A trip lands at regional scale: close enough to read the event's surroundings, and it opens placement's pool so the local story fills in around it.
const TRAVEL_ZOOM = 4.4
// [Agent] While playing, the camera leans in only slightly past the home view, enough to feel it following the story without losing the world around it.
const GLIDE_ZOOM = 2.5

// [Agent] The composition root for the map. It creates the MapLibre map, plugs in borders, hover and placement, and is the only map module that talks to the app: it reads the store, and user input goes back through navigation. Returns the cleanup, which is what React's useEffect wants.
export function createAtlas(container: HTMLElement, events: EventsData) {
  let epoch = epochAt(store.getState().year)
  let styleReady = false
  let placeTimer = 0
  let lastPlaced = 0
  let hideTimer = 0
  // [Agent] The last placement, fed back so events already on screen hold their spot while the camera pans. It resets on a real zoom step or a filter change, which should re-rank from scratch.
  let previous: Previous | null = null
  let previousZoom = 0
  // [Agent] Ranking depends only on the window and the filters, so a pan or zoom reuses it and only placement re-runs.
  let ranking: { timeWindow: TimeWindow; hiddenCategories: number[]; ranked: number[] } | null = null

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
  const hover = createHover(map, hovered => store.setState({ hovered: hovered && { index: hovered.index, x: hovered.point.x, y: hovered.point.y } }))

  function place() {
    placeTimer = 0
    lastPlaced = performance.now()
    if (!styleReady) return
    const { year, timeWindow, hiddenCategories, selected, flight, projection, detail } = store.getState()
    const next = epochAt(year)
    if (next !== epoch) {
      epoch = next
      applyEpoch(map, epoch)
      clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => hideInactive(map, epoch), FADE_MS + 50)
    }
    borders.show(year)

    if (Math.abs(map.getZoom() - previousZoom) > 0.25) previous = null
    const viewport = viewportOf(map, projection === 'globe')
    const pinned = [selected, flight].filter(i => i !== null)
    if (ranking?.timeWindow !== timeWindow || ranking.hiddenCategories !== hiddenCategories)
      ranking = { timeWindow, hiddenCategories, ranked: rankWindow(events, timeWindow, hiddenCategories) }
    const { placed, lod } = placeEvents(events, viewport, { ranked: ranking.ranked, pinned, detail, font: epoch.font }, previous)
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
        geometry: { type: 'Point', coordinates: [events.positions[p.index * 2], events.positions[p.index * 2 + 1]] },
      })),
    })
    store.setState({ lod })
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
  const lngLatOf = (i: number): [number, number] => [events.positions[i * 2], events.positions[i * 2 + 1]]

  // [Agent] Bring an event into view if it isn't already visible beside the panel. The fly-to carries the padding itself, because two camera calls in a row cancel each other in MapLibre.
  function reveal(index: number) {
    const padding = panelPadding(true)
    const at = viewportOf(map, store.getState().projection === 'globe').locate(...lngLatOf(index))
    if (!at || at.x > container.clientWidth - padding.right) map.flyTo({ center: lngLatOf(index), zoom: Math.max(map.getZoom(), 3.5), padding, duration: 1600 })
    else map.easeTo({ padding, duration: 700 })
  }

  // [Agent] The time machine's camera: a long, high arc down to regional scale, already padded for the panel that opens on arrival, then a ripple when it lands.
  function travel(index: number) {
    map.flyTo({ center: lngLatOf(index), zoom: TRAVEL_ZOOM, padding: panelPadding(true), curve: 1.7, duration: 2200, essential: true })
    map.once('moveend', () => store.getState().flight === index && pulse.play(index))
  }

  // [Agent] Play's drift toward the headline of the moment: a slow ease that never zooms out if you're already closer, and keeps the panel's padding.
  function glide(index: number) {
    const padding = panelPadding(store.getState().selected !== null)
    map.easeTo({ center: lngLatOf(index), zoom: Math.max(map.getZoom(), GLIDE_ZOOM), padding, duration: 2400, easing: t => t * t * (3 - 2 * t) })
  }

  const camera = { reveal, travel, glide }

  map.once('style.load', () => {
    styleReady = true
    place()
    // [Agent] The opening shot: the globe drifts in from afar and lands softly on the home view. A shared link to an event goes straight to that event instead.
    const { selected } = store.getState()
    if (selected === null) home(2800)
    else reveal(selected)
  })
  map.on('move', schedulePlace)
  map.on('click', e => {
    const hit = map.queryRenderedFeatures(e.point, { layers: ['event-bubbles', 'event-labels'] })[0]
    select(hit ? Number(hit.id) : null)
  })

  const unsubscribe = store.subscribe((state, prev) => {
    const filtersChanged = state.hiddenCategories !== prev.hiddenCategories || state.detail !== prev.detail
    if (filtersChanged) previous = null
    if (filtersChanged || state.timeWindow !== prev.timeWindow || state.year !== prev.year || state.selected !== prev.selected || state.flight !== prev.flight) schedulePlace()
    if (state.projection !== prev.projection) {
      map.setProjection({ type: state.projection })
      schedulePlace()
    }
    // [Agent] Camera, at most one call per update. The tour's first spotlight rings the globe at its home view, so opening the tour wins. Then an explicit camera command from navigation, and otherwise the panel opening or closing, which only changes the padding.
    if (state.tourOpen && !prev.tourOpen) home(1400)
    else if (state.camera && state.camera !== prev.camera) camera[state.camera.mode](state.camera.index)
    else if ((state.selected === null) !== (prev.selected === null)) map.easeTo({ padding: panelPadding(state.selected !== null), duration: 700 })
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
