// [Agent] Responsibility: every decision about the data. SQLite facts → public/data/events.bin + events-meta.json: which events ship, where they sit and how important they are.
// events.bin holds the numeric columns, and events-meta.json the strings only the UI needs. Rows are sorted by score, most important first, so the app ranks events by walking from the top.
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
import { CATEGORIES } from '../src/lib/categories.ts'

// [Agent] The floor for existing at all. A tenth of articles have zero incoming links and the bottom fifth fewer than ten: orphan stubs nobody links to.
const MIN_INLINKS = 10
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
  SELECT e.*, coalesce(e.year_end, e.year) AS year_end, a.inlinks, a.lon AS article_lon, a.lat AS article_lat
  FROM events e JOIN articles a USING (article) WHERE a.inlinks >= ${MIN_INLINKS}`)
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

// [Agent] Layout: u32 count, then f32 columns [lon,lat]×n, start×n, end×n, score×n, inlinks×n, sitelinks×n, then a u8 category column. Every f32 column starts 4-byte aligned, so the client wraps each one as a typed-array view with no copy.
const buffer = new ArrayBuffer(4 + n * 28 + n)
new Uint32Array(buffer, 0, 1)[0] = n
const columns = {
  positions: new Float32Array(buffer, 4, n * 2),
  start: new Float32Array(buffer, 4 + n * 8, n),
  end: new Float32Array(buffer, 4 + n * 12, n),
  score: new Float32Array(buffer, 4 + n * 16, n),
  inlinks: new Float32Array(buffer, 4 + n * 20, n),
  sitelinks: new Float32Array(buffer, 4 + n * 24, n),
  category: new Uint8Array(buffer, 4 + n * 28, n),
}
events.forEach((r, i) => {
  columns.positions.set([r.lon, r.lat], i * 2)
  columns.start[i] = r.year
  columns.end[i] = r.year_end
  columns.score[i] = r.score
  columns.inlinks[i] = r.inlinks
  columns.sitelinks[i] = r.sitelinks
  columns.category[i] = r.category
})

// [Agent] Most enwiki titles are just the label with underscores, so those ship as "" and the client rebuilds them. That keeps the meta file about a third smaller.
const meta = {
  qid: events.map(r => Number(r.qid.slice(1))),
  label: events.map(r => r.label),
  article: events.map(r => (r.article === r.label.replaceAll(' ', '_') ? '' : r.article)),
}

mkdirSync('public/data', { recursive: true })
writeFileSync('public/data/events.bin', new Uint8Array(buffer))
writeFileSync('public/data/events-meta.json', JSON.stringify(meta))

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
console.log(`  events.bin ${(buffer.byteLength / 1e6).toFixed(1)}MB, events-meta.json ${(JSON.stringify(meta).length / 1e6).toFixed(1)}MB`)
