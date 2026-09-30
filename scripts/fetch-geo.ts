// [Agent] Downloads the base geography and the historical border snapshots, shrinks them for the browser, and generates the cartographic decoration (graticule, portolan rhumb lines). Raw downloads are cached in data/raw, so re-runs only redo the processing.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const BORDERS = 'https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson'
const NATURAL_EARTH = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson'
// [Agent] The snapshot years historical-basemaps publishes inside our -3000 → 2026 range. Its "bc1" file is 1 BC, stored here as -1 like the event years.
const SNAPSHOTS = [-3000, -2000, -1500, -1000, -700, -500, -400, -323, -300, -200, -100, -1, 100, 200, 300, 400, 500, 600, 700,
  800, 900, 1000, 1100, 1200, 1279, 1300, 1400, 1492, 1500, 1530, 1600, 1650, 1700, 1715, 1783, 1800, 1815, 1880, 1900, 1914,
  1920, 1930, 1938, 1945, 1960, 1994, 2000, 2010]
// [Agent] Enough tones that neighbours rarely share one. The border line keeps them apart when they do.
const POLITY_TONES = 8
// [Agent] Where the Age of Sail chart draws its compass roses. Each one radiates 16 rhumb lines, the way portolan charts laid out their wind directions.
const ROSES = [[-32, 30], [16, 36], [68, -8], [-150, 8], [122, 14], [-28, -32], [-60, 48]]

mkdirSync('data/raw', { recursive: true })
mkdirSync('public/geo/borders', { recursive: true })

async function download(url: string, file: string) {
  if (existsSync(file)) return
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
}

function mapshaper(input: string, output: string, commands: string[]) {
  execFileSync('node_modules/.bin/mapshaper', ['-i', input, ...commands, '-o', output, 'format=geojson', 'precision=0.01', 'force'], { stdio: 'pipe' })
  return JSON.parse(readFileSync(output, 'utf8'))
}

for (const name of ['land', 'ocean', 'lakes', 'rivers_lake_centerlines']) {
  const raw = `data/raw/ne_50m_${name}.geojson`
  await download(`${NATURAL_EARTH}/ne_50m_${name}.geojson`, raw)
  mapshaper(raw, `public/geo/${name.split('_')[0]}.json`, ['-simplify', '40%', 'keep-shapes', '-filter-fields', 'scalerank'])
  console.log(`✓ ${name}`)
}

await Promise.all(SNAPSHOTS.map(async year => {
  const raw = `data/raw/world_${year}.geojson`
  await download(`${BORDERS}/world_${year < 0 ? `bc${-year}` : year}.geojson`, raw)
  const out = `public/geo/borders/${year}.json`
  const polygons = mapshaper(raw, out, ['-simplify', '25%', 'keep-shapes', '-filter-fields', 'NAME'])
  // [Agent] Labels get their own inner points. Letting MapLibre label the polygons directly repeats the name on every tile the polygon crosses. The area becomes the sort key, so big empires win label collisions over city states.
  const labels = mapshaper(raw, out, ['-each', 'area=Math.round(this.area/1e6)', '-points', 'inner', '-filter-fields', 'NAME,area'])

  const features = []
  for (const f of polygons.features) {
    if (!f.geometry) continue
    // [Agent] The tone comes from a hash of the polity name, so Rome keeps the same colour from one snapshot to the next instead of reshuffling when the feature order changes.
    const name: string = f.properties.NAME ?? ''
    let hash = 0
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
    features.push({ ...f, properties: { tone: Math.abs(hash) % POLITY_TONES } })
  }
  for (const f of labels.features)
    if (f.geometry && f.properties.NAME) features.push({ ...f, properties: { name: f.properties.NAME, area: f.properties.area } })
  writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }))
}))
writeFileSync('public/geo/borders/index.json', JSON.stringify(SNAPSHOTS))
console.log(`✓ ${SNAPSHOTS.length} border snapshots`)

// [Agent] Lines are densified every degree or two. MapLibre draws straight segments between vertices, so sparse meridians and rhumb lines would cut corners on the globe.
const graticule = []
for (let lon = -180; lon < 180; lon += 15) {
  const coords = []
  for (let lat = -80; lat <= 80; lat += 2) coords.push([lon, lat])
  graticule.push({ type: 'Feature', properties: { kind: lon === 0 ? 'major' : 'minor' }, geometry: { type: 'LineString', coordinates: coords } })
}
for (const [lat, kind] of [...[-75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75].map(l => [l, l === 0 ? 'major' : 'minor']),
  [23.44, 'circle'], [-23.44, 'circle'], [66.56, 'circle'], [-66.56, 'circle']] as [number, string][]) {
  const coords = []
  for (let lon = -180; lon <= 180; lon += 2) coords.push([lon, lat])
  graticule.push({ type: 'Feature', properties: { kind }, geometry: { type: 'LineString', coordinates: coords } })
}
writeFileSync('public/geo/graticule.json', JSON.stringify({ type: 'FeatureCollection', features: graticule }))

// [Agent] A rhumb line keeps a constant compass bearing, which makes it a straight line in Mercator space. So we step along that straight line and convert each step back to lon/lat.
const portolan = []
for (const [lon0, lat0] of ROSES) {
  portolan.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon0, lat0] } })
  const x0 = (lon0 * Math.PI) / 180
  const y0 = Math.log(Math.tan(Math.PI / 4 + (lat0 * Math.PI) / 360))
  for (let wind = 0; wind < 16; wind++) {
    const bearing = (wind * Math.PI) / 8
    const coords = []
    for (let step = 0; step <= 60; step++) {
      const d = step * 0.025
      const lat = (Math.atan(Math.exp(y0 + Math.cos(bearing) * d)) * 360) / Math.PI - 90
      if (Math.abs(lat) > 78) break
      coords.push([Math.round((x0 + Math.sin(bearing) * d) * 18000 / Math.PI) / 100, Math.round(lat * 100) / 100])
    }
    portolan.push({ type: 'Feature', properties: { main: wind % 2 === 0 }, geometry: { type: 'LineString', coordinates: coords } })
  }
}
writeFileSync('public/geo/portolan.json', JSON.stringify({ type: 'FeatureCollection', features: portolan }))
console.log('✓ graticule + portolan')
