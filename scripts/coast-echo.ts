// [Agent] Generalize only the decorative coast guide, once at data-build time. Exact land/ocean data stays untouched, holes never echo, and small islands cannot turn offsets into crossed scribbles.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { FeatureCollection, LineString, MultiPolygon, Polygon } from 'geojson'

const land = JSON.parse(readFileSync('public/geo/land.json', 'utf8')) as FeatureCollection<Polygon | MultiPolygon>
const features = land.features.flatMap(feature => {
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates
  return polygons.flatMap(([outer]) => {
    const area =
      outer.reduce((sum, [x, y], i) => {
        const [nx, ny] = outer[(i + 1) % outer.length]
        return sum + x * ny - nx * y
      }, 0) / 2
    if (Math.abs(area) < 2) return []
    return [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: area < 0 ? outer : outer.toReversed() } }]
  })
})
const guide: FeatureCollection<LineString> = { type: 'FeatureCollection', features }
// [Agent] Reuse the installed simplifier instead of shipping geometry processing to every viewer. About 4 km matches the audited .04-degree guide without altering the shoreline itself.
execFileSync(
  'node_modules/.bin/mapshaper',
  ['-i', '-', '-simplify', 'dp', 'interval=4000', '-o', 'public/geo/coast-echo.json', 'format=geojson', 'geojson-type=FeatureCollection', 'precision=0.001', 'force'],
  {
    input: JSON.stringify(guide),
    stdio: ['pipe', 'pipe', 'pipe'],
  },
)
console.log(`✓ coast echoes: ${features.length} outer rings`)
