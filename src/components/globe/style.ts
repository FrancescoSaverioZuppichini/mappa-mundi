// [Agent] Responsibility: the MapLibre style for every era, and switching eras by fading paint in place.

import type { LayerSpecification, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'
import { UNICODE_RANGES } from '../../consts'
import { CATEGORIES } from '../../lib/categories'
import { EPOCHS } from '../../lib/epochs'
import type { EpochConfig, TextureName } from '../../types'

// [Agent] Every epoch's layers live in one style. Switching epochs never calls setStyle, which reloads every source and janks. Instead, applyEpoch fades opacities and swaps paint in place, and hideInactive drops the faded-out layers afterwards so they stop fetching tiles.
export const FADE_MS = 700

const EMPTY = { type: 'FeatureCollection' as const, features: [] }
// [Agent] Google's standard unicode ranges for the two Latin subsets, so each font file only claims the characters it actually has.
// [Agent] A value that grows linearly from zoom 1 to zoom 6: line widths and text sizes that thicken as you zoom in.
const byZoom = (min: number, max: number) => ['interpolate', ['linear'], ['zoom'], 1, min, 6, max]
// [Agent] Animated levels (0..1) that hover.ts and pulse.ts write into each event's feature state.
const HOVER = ['number', ['feature-state', 'hover'], 0]
const ARRIVAL = ['number', ['feature-state', 'arrival'], 0]

// [Agent] Mixes a hex colour toward another by t (0..1), for a ring that is a variant of the bubble's own colour.
function mix(hex: string, toward: string, t: number) {
  const channels = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const [a, b] = [channels(hex), channels(toward)]
  return `#${a
    .map((v, i) =>
      Math.round(v + (b[i] - v) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

// [Agent] Features carry their category; the style turns it into colour, so the colours stay a styling decision and change with the epoch.
const byCategory = (colorOf: (color: string) => string) => ['match', ['get', 'category'], ...CATEGORIES.flatMap((c, i) => [i, colorOf(c.color)]), '#888888']

const LAYERS = [
  { id: 'ocean', type: 'background' },
  { id: 'land', type: 'fill', source: 'land' },
  { id: 'relief', type: 'hillshade', source: 'dem', paint: { 'hillshade-illumination-anchor': 'map' } },
  // [Agent] The DEM carries sea-floor relief too. Redrawing the sea above the hillshade masks it, so relief only shades the land the way old maps did.
  { id: 'sea', type: 'fill', source: 'sea' },
  { id: 'satellite', type: 'raster', source: 'satellite' },
  // [Agent] Echo lines around every coast, the old engraver's trick. The negative offset pushes them outward because the land rings are wound clockwise.
  { id: 'ripple-1', type: 'line', source: 'land', paint: { 'line-offset': -3, 'line-width': 0.5 } },
  { id: 'ripple-2', type: 'line', source: 'land', paint: { 'line-offset': -6, 'line-width': 0.4 } },
  { id: 'ripple-3', type: 'line', source: 'land', paint: { 'line-offset': -10, 'line-width': 0.35 } },
  { id: 'graticule', type: 'line', source: 'graticule', filter: ['!=', ['get', 'kind'], 'circle'], paint: { 'line-width': ['match', ['get', 'kind'], 'major', 0.7, 0.35] } },
  { id: 'graticule-circles', type: 'line', source: 'graticule', filter: ['==', ['get', 'kind'], 'circle'], paint: { 'line-width': 0.5, 'line-dasharray': [4, 3] } },
  { id: 'rhumbs', type: 'line', source: 'portolan', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-width': 0.4 } },
  { id: 'polities', type: 'fill', source: 'polities', filter: ['has', 'tone'] },
  { id: 'lakes', type: 'fill', source: 'lakes' },
  { id: 'rivers', type: 'line', source: 'rivers', paint: { 'line-width': byZoom(0.3, 1.1) } },
  { id: 'border-glow', type: 'line', source: 'polities', filter: ['has', 'tone'], paint: { 'line-width': byZoom(2.5, 6), 'line-blur': 3 } },
  { id: 'borders', type: 'line', source: 'polities', filter: ['has', 'tone'] },
  {
    id: 'roses',
    type: 'symbol',
    source: 'portolan',
    filter: ['==', ['geometry-type'], 'Point'],
    layout: { 'icon-image': 'rose', 'icon-size': byZoom(0.35, 1), 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-pitch-alignment': 'map', 'icon-rotation-alignment': 'map' },
  },
  {
    id: 'polity-labels',
    type: 'symbol',
    source: 'polities',
    filter: ['has', 'name'],
    minzoom: 1.4,
    layout: {
      'text-field': ['get', 'name'],
      'text-size': byZoom(8, 13),
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.24,
      'text-max-width': 7,
      'text-padding': 8,
      // [Agent] Big empires win label collisions over city states.
      'symbol-sort-key': ['-', 0, ['get', 'area']],
    },
  },
  // [Agent] Events are the placement's output (placement.ts): a few dozen features, each already guaranteed room for its bubble and label. Both layers share one source, so a bubble and its label can never disagree.
  // [Agent] A soft glow under the five headline events of the view, so the eye has somewhere to land first.
  {
    id: 'event-glow',
    type: 'circle',
    source: 'events',
    filter: ['get', 'headline'],
    paint: { 'circle-radius': ['*', ['get', 'radius'], 2.2], 'circle-blur': 1 },
  },
  // [Agent] Hovering swells the bubble a touch, and a thin ring in a variant of its own colour grows out around it. The selected event keeps its ring.
  {
    id: 'event-bubbles',
    type: 'circle',
    source: 'events',
    paint: { 'circle-radius': ['*', ['get', 'radius'], ['+', 1, ['*', 0.18, HOVER]]], 'circle-color': byCategory(c => c), 'circle-stroke-opacity': 0.9 },
  },
  {
    id: 'event-ring',
    type: 'circle',
    source: 'events',
    paint: {
      'circle-radius': ['+', ['*', ['get', 'radius'], 1.18], ['*', 5, ['max', HOVER, ['case', ['get', 'selected'], 1, 0]]]],
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-width': 1.5,
      'circle-stroke-opacity': ['max', HOVER, ['case', ['get', 'selected'], 1, 0]],
    },
  },
  // [Agent] The time machine's landing: a ring that grows from the bubble and fades as it goes.
  {
    id: 'event-ripple',
    type: 'circle',
    source: 'events',
    paint: {
      'circle-radius': ['+', ['get', 'radius'], ['*', 42, ARRIVAL]],
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-width': 2,
      'circle-stroke-opacity': ['case', ['>', ARRIVAL, 0], ['-', 1, ARRIVAL], 0],
    },
  },
  {
    id: 'event-labels',
    type: 'symbol',
    source: 'events',
    filter: ['get', 'labeled'],
    layout: {
      'text-size': ['get', 'size'],
      'text-anchor': ['get', 'anchor'],
      'text-justify': 'auto',
      'text-offset': ['get', 'offset'],
      'text-max-width': 40,
      'text-line-height': 1.15,
      // [Agent] Placement already cleared the space, so MapLibre must draw every label. Leaving ignore-placement off still lets these labels push polity names out of their way.
      'text-allow-overlap': true,
    },
  },
] as LayerSpecification[]

type PaintName = Parameters<MapLibreMap['setPaintProperty']>[1]
type PaintValue = Parameters<MapLibreMap['setPaintProperty']>[2]
type LayoutName = Parameters<MapLibreMap['setLayoutProperty']>[1]
type LayoutValue = Parameters<MapLibreMap['setLayoutProperty']>[2]

const OPACITY: Record<LayerSpecification['type'], PaintName> = {
  background: 'background-opacity',
  fill: 'fill-opacity',
  line: 'line-opacity',
  raster: 'raster-opacity',
  hillshade: 'hillshade-exaggeration',
  symbol: 'icon-opacity',
  circle: 'circle-opacity',
  heatmap: 'heatmap-opacity',
  'fill-extrusion': 'fill-extrusion-opacity',
  'color-relief': 'color-relief-opacity',
}

type LayerLook = { opacity: number; paint: Record<string, unknown>; layout?: Record<string, unknown> }

// [Agent] The per-epoch half of each layer. Opacity 0 means "not part of this epoch". Symbol layers fade through icon-opacity, so the label layer fades its text separately.
function look(epoch: EpochConfig): Record<string, LayerLook> {
  const m = epoch.map
  const pattern = (texture: TextureName | null, part: 'land' | 'ocean') => (texture ? `${epoch.id}-${part}` : undefined)
  const sea = { 'fill-color': m.ocean, 'fill-pattern': pattern(m.oceanTexture, 'ocean') }
  const ripple = (opacity: number): LayerLook => ({ opacity: m.ripples ? opacity : 0, paint: { 'line-color': m.ripples ?? m.ocean } })
  // [Agent] The ring is the bubble's own colour pushed toward contrast with the map: darker on the paper maps, lighter on the night-time satellite globe.
  const ringColor = byCategory(c => (m.satellite ? mix(c, '#ffffff', 0.45) : mix(c, '#000000', 0.25)))
  return {
    ocean: { opacity: 1, paint: { 'background-color': m.ocean } },
    land: { opacity: 1, paint: { 'fill-color': m.land, 'fill-pattern': pattern(m.landTexture, 'land') } },
    relief: {
      opacity: m.relief?.strength ?? 0,
      paint: m.relief ? { 'hillshade-shadow-color': m.relief.shadow, 'hillshade-highlight-color': m.relief.highlight, 'hillshade-accent-color': m.relief.accent } : {},
    },
    sea: { opacity: 1, paint: sea },
    satellite: { opacity: m.satellite ? 1 : 0, paint: {} },
    'ripple-1': ripple(0.4),
    'ripple-2': ripple(0.22),
    'ripple-3': ripple(0.1),
    graticule: { opacity: m.graticule ? 0.3 : 0, paint: { 'line-color': m.graticule ?? m.ocean } },
    'graticule-circles': { opacity: m.graticule ? 0.35 : 0, paint: { 'line-color': m.graticule ?? m.ocean } },
    rhumbs: { opacity: m.rhumbs ? 0.3 : 0, paint: { 'line-color': m.rhumbs ? ['case', ['get', 'main'], m.rhumbs.main, m.rhumbs.half] : m.ocean } },
    polities: { opacity: m.polityOpacity * 0.7, paint: { 'fill-color': ['match', ['get', 'tone'], ...m.polities.flatMap((c, i) => [i, c]), m.polities[0]] } },
    lakes: { opacity: 1, paint: sea },
    rivers: { opacity: m.satellite ? 0.25 : 0.55, paint: { 'line-color': m.river } },
    'border-glow': { opacity: m.borderGlow ? 0.3 : 0, paint: { 'line-color': m.borderGlow ?? m.border } },
    borders: { opacity: 0.5, paint: { 'line-color': m.border, 'line-width': byZoom(m.borderWidth * 0.35, m.borderWidth * 1.1) } },
    roses: { opacity: m.rhumbs ? 0.7 : 0, paint: {} },
    'polity-labels': {
      opacity: 1,
      paint: { 'text-color': m.label, 'text-halo-color': m.halo, 'text-halo-width': 1, 'text-opacity': 0.5 },
      layout: { 'text-font': [epoch.id] },
    },
    'event-glow': { opacity: m.satellite ? 0.4 : 0.25, paint: { 'circle-color': epoch.ui.accent } },
    // [Agent] A thin keyline in the map's halo colour (paper on the old maps, night on the satellite) lifts each bubble off the map without a heavy outline.
    'event-bubbles': { opacity: 0.88, paint: { 'circle-stroke-color': m.halo, 'circle-stroke-width': 1 } },
    'event-ring': { opacity: 1, paint: { 'circle-stroke-color': ringColor } },
    'event-ripple': { opacity: 1, paint: { 'circle-stroke-color': ringColor } },
    'event-labels': {
      opacity: 1,
      paint: { 'text-color': m.label, 'text-halo-color': m.halo, 'text-halo-width': 1, 'text-halo-blur': 0.6, 'text-opacity': 0.95 },
      // [Agent] Two lines: the name, then the date smaller and at 70% (the b3 alpha suffix), so the eye reads what before when.
      layout: { 'text-font': [epoch.id], 'text-field': ['format', ['get', 'name'], {}, '\n', {}, ['get', 'when'], { 'font-scale': 0.78, 'text-color': `${m.label}b3` }] },
    },
  }
}

export function createStyle(epoch: EpochConfig): StyleSpecification {
  const current = look(epoch)
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    // [Agent] One font stack per epoch, named by the epoch id. MapLibre rasterises these TTFs locally, so map labels use the same typefaces as the UI.
    'font-faces': Object.fromEntries(
      EPOCHS.map(e => [
        e.id,
        e.mapFonts.map(({ family, subset, weight }) => ({
          url: `/fonts/map/${family}-${subset}-${weight}.ttf`,
          'unicode-range': UNICODE_RANGES[subset],
        })),
      ]),
    ),
    projection: { type: 'globe' },
    transition: { duration: FADE_MS, delay: 0 },
    sources: {
      land: { type: 'geojson', data: '/geo/land.json', attribution: 'Natural Earth' },
      sea: { type: 'geojson', data: '/geo/ocean.json' },
      lakes: { type: 'geojson', data: '/geo/lakes.json' },
      rivers: { type: 'geojson', data: '/geo/rivers.json' },
      graticule: { type: 'geojson', data: '/geo/graticule.json' },
      portolan: { type: 'geojson', data: '/geo/portolan.json' },
      polities: { type: 'geojson', data: EMPTY, attribution: '<a href="https://github.com/aourednik/historical-basemaps">historical-basemaps</a>' },
      events: { type: 'geojson', data: EMPTY, promoteId: 'id', attribution: 'Events: Wikidata · Wikipedia' },
      // [Agent] Mapzen terrain tiles on AWS Open Data: public and keyless. Capped at z10 because hillshade doesn't gain anything past that at our zooms.
      dem: {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 10,
        attribution: 'Terrain: Mapzen / AWS',
      },
      satellite: {
        type: 'raster',
        tileSize: 256,
        maxzoom: 8,
        tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg'],
        attribution: 'NASA Blue Marble',
      },
    },
    layers: LAYERS.map(layer => {
      const { opacity, paint, layout } = current[layer.id]
      // [Agent] Undefined means "no pattern" for setPaintProperty, but the style validator rejects undefined values, so they are dropped here.
      const defined = Object.fromEntries(Object.entries(paint).filter(([, v]) => v !== undefined))
      return {
        ...layer,
        layout: { ...('layout' in layer ? layer.layout : {}), ...layout, visibility: opacity > 0 ? 'visible' : 'none' },
        paint: { ...('paint' in layer ? layer.paint : {}), ...defined, [OPACITY[layer.type]]: opacity },
      } as LayerSpecification
    }),
  }
}

export function applyEpoch(map: MapLibreMap, epoch: EpochConfig) {
  for (const [id, { opacity, paint, layout = {} }] of Object.entries(look(epoch))) {
    if (opacity > 0) map.setLayoutProperty(id, 'visibility', 'visible')
    for (const [property, value] of Object.entries(layout)) map.setLayoutProperty(id, property as LayoutName, value as LayoutValue)
    for (const [property, value] of Object.entries(paint)) map.setPaintProperty(id, property as PaintName, value as PaintValue)
    map.setPaintProperty(id, OPACITY[map.getLayer(id)!.type as LayerSpecification['type']], opacity)
  }
}

export function hideInactive(map: MapLibreMap, epoch: EpochConfig) {
  for (const [id, { opacity }] of Object.entries(look(epoch))) if (opacity === 0) map.setLayoutProperty(id, 'visibility', 'none')
}
