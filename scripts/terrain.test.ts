import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { VectorTile } from '@mapbox/vector-tile'
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import type { FeatureCollection, LineString, Polygon } from 'geojson'
import mlcontour from 'maplibre-contour'
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'
import { PbfReader } from 'pbf'
import { applyEpoch, createStyle, hideInactive } from '../src/components/globe/style.ts'
import { EPOCHS } from '../src/lib/epochs.ts'

const terrain = { dem: 'dem-shared://{z}/{x}/{y}', contours: 'dem-contour://{z}/{x}/{y}?thresholds=2*300*1500' }
const layer = (style: StyleSpecification, id: string) => style.layers.find(l => l.id === id)!

test('all epoch styles validate, with water masking physical terrain below history overlays', () => {
  for (const epoch of EPOCHS) {
    const style = createStyle(epoch, terrain)
    assert.deepEqual(
      validateStyleMin(style).map(e => e.message),
      [],
      epoch.id,
    )
    const order = style.layers.map(l => l.id)
    assert.ok(order.indexOf('contours') < order.indexOf('sea'))
    assert.ok(order.indexOf('contours') < order.indexOf('lakes'))
    assert.ok(order.indexOf('coastline') < order.indexOf('polities'))
    assert.ok(order.indexOf('polities') < order.indexOf('event-bubbles'))
    assert.equal(layer(style, 'height-wash').layout?.visibility, epoch.map.satellite ? 'none' : 'visible')
    assert.equal(layer(style, 'satellite').layout?.visibility, epoch.map.satellite ? 'visible' : 'none')
  }
})

test('epoch changes remain valid and switching to modern retires all terrain layers', () => {
  const style = createStyle(EPOCHS[0], terrain)
  const map = {
    getLayer: (id: string) => layer(style, id),
    setPaintProperty: (id: string, name: string, value: unknown) => {
      const paint = layer(style, id).paint as Record<string, unknown>
      if (value === undefined) delete paint[name]
      else paint[name] = value
    },
    setLayoutProperty: (id: string, name: string, value: unknown) => {
      ;(layer(style, id).layout as Record<string, unknown>)[name] = value
    },
  } as unknown as MapLibreMap
  for (const epoch of [...EPOCHS, ...EPOCHS.toReversed()]) {
    applyEpoch(map, epoch)
    hideInactive(map, epoch)
    assert.deepEqual(
      validateStyleMin(style).map(e => e.message),
      [],
      epoch.id,
    )
    for (const id of ['height-wash', 'relief', 'contours', 'coastline']) assert.equal(layer(style, id).layout?.visibility, epoch.map.satellite ? 'none' : 'visible')
  }
})

test('real Terrarium metres produce 300m contours, fifth-level indices and cached vector tiles', async () => {
  const pixels = new Uint8ClampedArray(32 * 32 * 4)
  for (let i = 0; i < 32 * 32; i++) {
    const height = (i % 32) * 100 + 10.5 + 32768
    pixels.set([Math.floor(height / 256), Math.floor(height % 256), (height % 1) * 256, 255], i * 4)
  }
  const decoded = mlcontour.decodeParsedImage(32, 32, 'terrarium', pixels)
  assert.equal(decoded.data[0], 10.5)
  assert.equal(decoded.data[31], 3110.5)
  let fetches = 0
  const manager = new mlcontour.LocalDemManager({
    demUrlPattern: 'https://example.test/{z}/{x}/{y}.png',
    encoding: 'terrarium',
    maxzoom: 10,
    cacheSize: 100,
    timeoutMs: 10_000,
    getTile: async () => {
      fetches++
      return { data: new Blob() }
    },
    decodeImage: async () => decoded,
  })
  const options = { levels: [300, 1500], contourLayer: 'contours', elevationKey: 'elevation', levelKey: 'level' }
  const first = await manager.fetchContourTile(3, 4, 4, options, new AbortController())
  const tile = new VectorTile(new PbfReader(new Uint8Array(first.arrayBuffer))).layers.contours
  assert.ok(tile.length > 0)
  const elevations = []
  for (let i = 0; i < tile.length; i++) {
    const { elevation, level } = tile.feature(i).properties
    assert.equal(Number(elevation) % 300, 0)
    assert.equal(level, Number(elevation) % 1500 === 0 ? 1 : 0)
    elevations.push(elevation)
  }
  assert.ok(elevations.includes(1500))
  assert.equal(fetches, 9)
  const second = await manager.fetchContourTile(3, 4, 4, options, new AbortController())
  assert.equal(fetches, 9)
  assert.notEqual(first.arrayBuffer, second.arrayBuffer)
  assert.deepEqual(new Uint8Array(first.arrayBuffer), new Uint8Array(second.arrayBuffer))
})

test('coast echoes contain only closed clockwise outer rings from large land polygons', () => {
  const land = JSON.parse(readFileSync('public/geo/land.json', 'utf8')) as FeatureCollection<Polygon>
  const guide = JSON.parse(readFileSync('public/geo/coast-echo.json', 'utf8')) as FeatureCollection<LineString>
  const area = (ring: number[][]) =>
    ring.reduce((sum, [x, y], i) => {
      const [nx, ny] = ring[(i + 1) % ring.length]
      return sum + x * ny - nx * y
    }, 0) / 2
  assert.equal(guide.type, 'FeatureCollection')
  assert.equal(guide.features.length, land.features.filter(f => Math.abs(area(f.geometry.coordinates[0])) >= 2).length)
  let vertices = 0
  for (const feature of guide.features) {
    assert.equal(feature.geometry.type, 'LineString')
    const ring = feature.geometry.coordinates
    assert.ok(ring.length >= 4)
    assert.deepEqual(ring[0], ring.at(-1))
    assert.ok(area(ring) < 0)
    vertices += ring.length
  }
  const original = land.features.reduce((n, f) => n + f.geometry.coordinates[0].length, 0)
  assert.ok(vertices < original / 2)
})
