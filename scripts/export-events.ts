// [Agent] Responsibility: every decision about the data. SQLite facts → the dataset, two Feather (Arrow IPC) files joined on qid: which events ship, where they sit, how important they are, and what Wikipedia says about them.
// - events.arrow: the facts, which the app loads whole. The same file goes to Hugging Face. Rows are sorted by score, most important first, so the app ranks events by walking from the top.
// - leads.arrow: each event's Wikipedia lead, description and thumbnail, in the same row order. The app never loads it: scripts/seed-db.ts puts it in D1, and the Worker serves one row per opened event.
//
// Position, first match wins:
//   1. the event's own Wikidata coordinates;
//   2. its English Wikipedia article's {{coord}}, which many battles have even when Wikidata doesn't, naval battles especially;
//   3. the median of its located sub-events, when it has at least two: a war is where its battles were;
//   4. its first-listed Wikidata location. For a naval battle that is often a sea, which is the right answer.
// With none of these, the event can't be placed and is left out.
//
// score = robust in-degree × category weight:
// - Robust in-degree: CirrusSearch counts links that arrive through navbox templates, so an article in a navbox transcluded on 20k pages gets 20k "links" (the 2021 Austin shooting: 20,022 in-links, one language edition). Real prominence also shows up across languages. Canonical events sit at or below ~55 x sitelinks^1.5 (WWII 44, the French Revolution 6), while template-inflated articles sit at 170-190. So in-degree is capped at 60x, about the 95th percentile.
// - Category weight (categories.ts) damps places, whose links measure the modern city rather than its founding.

import { mkdirSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { CompressionType, dictionary, int8, setCompressionCodec, tableFromArrays, tableToIPC, utf8 } from '@uwdata/flechette'
import { CATEGORIES } from '../src/lib/categories.ts'
import { EVENTS_FILE, LEADS_FILE, MIN_INLINKS, ZSTD } from './consts.ts'

const TEMPLATE_CAP = 60

type Row = {
  qid: string
  label: string
  article: string
  category: number
  year: number
  year_end: number
  sitelinks: number
  inlinks: number
  own_lon: number | null
  own_lat: number | null
  article_lon: number | null
  article_lat: number | null
  parts_lon: number | null
  parts_lat: number | null
  parts: number
  loc_lon: number | null
  loc_lat: number | null
  description: string | null
  thumbnail: string | null
  lead_html: string | null
  extract: string | null
  fetched_at: string | null
}

function position(r: Row): { lon: number; lat: number; by: string } | null {
  if (r.own_lon !== null && r.own_lat !== null) return { lon: r.own_lon, lat: r.own_lat, by: 'wikidata' }
  if (r.article_lon !== null && r.article_lat !== null) return { lon: r.article_lon, lat: r.article_lat, by: 'wikipedia' }
  if (r.parts >= 2 && r.parts_lon !== null && r.parts_lat !== null) return { lon: r.parts_lon, lat: r.parts_lat, by: 'sub-events' }
  if (r.loc_lon !== null && r.loc_lat !== null) return { lon: r.loc_lon, lat: r.loc_lat, by: 'location' }
  return null
}

const db = new DatabaseSync('data/history.sqlite', { readOnly: true })
const rows = db
  .prepare(`
  SELECT e.*, coalesce(e.year_end, e.year) AS year_end, a.inlinks, a.lon AS article_lon, a.lat AS article_lat, a.description, a.thumbnail, l.lead_html, l.extract, l.fetched_at
  FROM events e JOIN articles a USING (article) LEFT JOIN leads l USING (article) WHERE a.inlinks >= ${MIN_INLINKS}`)
  .all() as Row[]

const placedBy: Record<string, number> = {}
const events = rows
  .flatMap(r => {
    const at = position(r)
    placedBy[at?.by ?? 'unplaceable'] = (placedBy[at?.by ?? 'unplaceable'] ?? 0) + 1
    return at ? [{ ...r, ...at, score: Math.min(r.inlinks, TEMPLATE_CAP * r.sitelinks ** 1.5) * CATEGORIES[r.category].weight }] : []
  })
  .sort((a, b) => b.score - a.score || b.sitelinks - a.sitelinks)
const n = events.length

// [Agent] One record batch, ZSTD-compressed: a reader unzips each column once, then wraps it as a typed array over those bytes, with no parsing. Float32Array inputs become float32 columns as they are. category and position_source are dictionary-encoded: the file says "battle", and each row costs one byte.
const eventsTable = tableFromArrays(
  {
    qid: events.map(r => r.qid),
    label: events.map(r => r.label),
    article: events.map(r => r.article),
    category: events.map(r => CATEGORIES[r.category].name),
    start: Float32Array.from(events, r => r.year),
    end: Float32Array.from(events, r => r.year_end),
    lon: Float32Array.from(events, r => r.lon),
    lat: Float32Array.from(events, r => r.lat),
    position_source: events.map(r => r.by),
    score: Float32Array.from(events, r => r.score),
    inlinks: Float32Array.from(events, r => r.inlinks),
    sitelinks: Float32Array.from(events, r => r.sitelinks),
  },
  { types: { qid: utf8(), label: utf8(), article: utf8(), category: dictionary(utf8(), int8()), position_source: dictionary(utf8(), int8()) } },
)

// [Agent] Same rows, same order, so the two files join on qid or by row. An event Wikipedia had nothing for is a row of nulls.
const leadsTable = tableFromArrays(
  {
    qid: events.map(r => r.qid),
    description: events.map(r => r.description),
    extract: events.map(r => r.extract),
    lead_html: events.map(r => r.lead_html),
    thumbnail: events.map(r => r.thumbnail),
    fetched_at: events.map(r => r.fetched_at),
  },
  { types: { qid: utf8(), description: utf8(), extract: utf8(), lead_html: utf8(), thumbnail: utf8(), fetched_at: utf8() } },
)

mkdirSync('data/release', { recursive: true })
mkdirSync('public/data', { recursive: true })
setCompressionCodec(CompressionType.ZSTD, ZSTD)
const eventsBytes = tableToIPC(eventsTable, { format: 'file', codec: CompressionType.ZSTD })!
const leadsBytes = tableToIPC(leadsTable, { format: 'file', codec: CompressionType.ZSTD })!
writeFileSync(EVENTS_FILE, eventsBytes)
writeFileSync(LEADS_FILE, leadsBytes)
const mb = (bytes: Uint8Array) => `${(bytes.byteLength / 1e6).toFixed(1)}MB`

console.log(
  `✓ ${n} events, placed by ${Object.entries(placedBy)
    .map(([by, count]) => `${by} ${count}`)
    .join(', ')}`,
)
console.log(`  ${CATEGORIES.map((c, i) => `${c.name}: ${events.filter(r => r.category === i).length}`).join('  ')}`)
console.log(
  `  top: ${events
    .slice(0, 12)
    .map(r => r.label)
    .join(' · ')}`,
)
console.log(`  leads: ${events.filter(r => r.lead_html).length} of ${n}, thumbnails: ${events.filter(r => r.thumbnail).length}`)
console.log(`  ${EVENTS_FILE} ${mb(eventsBytes)}, ${LEADS_FILE} ${mb(leadsBytes)}`)
