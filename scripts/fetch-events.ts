// [Agent] Responsibility: Wikidata facts → data/history.sqlite. Queries QLever per category class and records every event's dates, sitelinks and position candidates. It decides nothing: export-events.ts does.
// This script only records facts. Every position candidate is kept side by side (own coordinates, sub-event median, first-listed location), and export-events.ts decides which one to use, alongside the Wikipedia facts from fetch-wikipedia.ts.
// Every class in CATEGORIES is logged in `fetched` once it lands, so a crashed run resumes. `--refresh` rebuilds the table from scratch, and category names limit the run to those.

import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { CATEGORIES } from '../src/lib/categories.ts'

const args = process.argv.slice(2)
const refresh = args.includes('--refresh')
const only = args.filter(a => !a.startsWith('--'))
const USER_AGENT = 'mappa-mundi/0.1 (francesco@scrapegraphai.com)'

mkdirSync('data', { recursive: true })
const db = new DatabaseSync('data/history.sqlite')
if (refresh) db.exec('DROP TABLE IF EXISTS events; DROP TABLE IF EXISTS fetched')
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    qid TEXT PRIMARY KEY, label TEXT NOT NULL, article TEXT NOT NULL, category INTEGER NOT NULL,
    year INTEGER NOT NULL, year_end INTEGER, sitelinks INTEGER NOT NULL,
    own_lon REAL, own_lat REAL, parts_lon REAL, parts_lat REAL, parts INTEGER NOT NULL, loc_lon REAL, loc_lat REAL);
  CREATE TABLE IF NOT EXISTS fetched (class TEXT PRIMARY KEY, items INTEGER NOT NULL, at TEXT NOT NULL);`)

// [Agent] A lower category index wins on conflict. Classes finish in any order, and this way a battle stays a battle when the catch-all "historical event" class returns it again.
const upsert = db.prepare(`
  INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(qid) DO UPDATE SET category = min(category, excluded.category)`)
const markFetched = db.prepare(`INSERT OR REPLACE INTO fetched VALUES (?, ?, datetime('now'))`)
const alreadyFetched = new Set((db.prepare('SELECT class FROM fetched').all() as { class: string }[]).map(r => r.class))

const PREFIXES = `
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX schema: <http://schema.org/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>`

// [Agent] Only items with an English Wikipedia article: it's the notability bar, and both in-degree and article coordinates need one.
const eventsQuery = (cls: string) => `${PREFIXES}
SELECT ?e ?label ?article ?sitelinks ?coord ?loc ?locCoord ?time ?start ?inception ?end WHERE {
  ?e wdt:P31/wdt:P279* wd:${cls} ; wikibase:sitelinks ?sitelinks .
  ?article schema:about ?e ; schema:isPartOf <https://en.wikipedia.org/> .
  ?e rdfs:label ?label FILTER(LANG(?label) = "en")
  OPTIONAL { ?e wdt:P625 ?coord }
  OPTIONAL { ?e wdt:P276 ?loc . ?loc wdt:P625 ?locCoord }
  OPTIONAL { ?e wdt:P585 ?time }
  OPTIONAL { ?e wdt:P580 ?start }
  OPTIONAL { ?e wdt:P571 ?inception }
  OPTIONAL { ?e wdt:P582 ?end }
}`

// [Agent] Everything that is "part of" an event, transitively, with its own coordinates. WWII has 1,124 of them, the American Revolutionary War 262.
const subEventsQuery = (cls: string) => `${PREFIXES}
SELECT ?e ?coord WHERE {
  ?e wdt:P31/wdt:P279* wd:${cls} .
  ?article schema:about ?e ; schema:isPartOf <https://en.wikipedia.org/> .
  ?part wdt:P361+ ?e ; wdt:P625 ?coord .
}`

type Binding = Record<string, { value: string } | undefined>
type Point = [lon: number, lat: number]
type Item = {
  label: string
  article: string
  sitelinks: number
  own?: Point
  locations: Map<string, Point>
  dates: { time?: number; start?: number; inception?: number; end?: number }
}

async function sparql(query: string): Promise<Binding[]> {
  // [Agent] Retry any failure, dropped connections and truncated bodies included. QLever is a shared public service and occasionally sheds load.
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch('https://qlever.dev/api/wikidata', {
        method: 'POST',
        headers: { Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        body: new URLSearchParams({ query }),
      })
      const body = await res.text()
      if (!res.ok) throw new Error(`${res.status} ${body.slice(0, 160)}`)
      // [Agent] Raw control characters sometimes leak into labels, and JSON.parse rejects them. Outside strings they are only whitespace, so blanking them is safe.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is exactly what this does.
      return JSON.parse(body.replace(/[\u0000-\u001f]/g, ' ')).results.bindings
    } catch (err) {
      if (attempt === 3) throw err
      await new Promise(r => setTimeout(r, 15_000 * attempt))
    }
  }
}

const idOf = (iri: string) => iri.slice(iri.lastIndexOf('/') + 1)

// [Agent] WKT points come as "POINT(lon lat)" in any case; points on other globes carry an IRI prefix, which the anchor rejects.
function parsePoint(wkt?: string): Point | undefined {
  const m = wkt?.match(/^point\(([-\d.eE]+) ([-\d.eE]+)\)$/i)
  return m ? [Number(m[1]), Number(m[2])] : undefined
}

// [Agent] RDF dates use astronomical numbering, where year 0 is 1 BC and Marathon (490 BC) is "-0489". Non-positive years shift down by one so the DB stores historical years. Unknown values arrive as blank nodes, which the pattern rejects.
function parseYear(iso?: string) {
  if (!iso || !/^-?\d+-/.test(iso)) return undefined
  const year = Number.parseInt(iso, 10)
  return year <= 0 ? year - 1 : year
}

// [Agent] Coordinate-wise median, so one stray outlier (a WWII raid on Darwin) can't drag the whole war. Longitudes are taken relative to the points' circular mean before the median, so a Pacific campaign straddling ±180° doesn't average out to Africa.
function medianPoint(points: Point[]): Point {
  const middle = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1]
  const rad = Math.PI / 180
  const ref =
    Math.atan2(
      points.reduce((s, [lon]) => s + Math.sin(lon * rad), 0),
      points.reduce((s, [lon]) => s + Math.cos(lon * rad), 0),
    ) / rad
  const lon = ref + middle(points.map(([lon]) => ((lon - ref + 540) % 360) - 180))
  return [((lon + 540) % 360) - 180, middle(points.map(([, lat]) => lat))]
}

// [Agent] With several locations, editors list the primary theatre first (the American Revolutionary War starts with the Eastern United States). Statement order only survives in the entity API, not in SPARQL, so those items are asked one by one.
async function firstListedLocations(qids: string[]) {
  type Claims = { claims?: { P276?: { mainsnak: { datavalue?: { value: { id: string } } } }[] } }
  const order = new Map<string, string[]>()
  const queue = [...qids]
  await Promise.all(
    [0, 1, 2, 3].map(async () => {
      for (let qid = queue.shift(); qid; qid = queue.shift()) {
        for (let attempt = 1; attempt <= 4; attempt++) {
          const url = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&property=P276&format=json`
          const body = (await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null)) as Claims | null
          if (body?.claims) {
            order.set(
              qid,
              (body.claims.P276 ?? []).flatMap(c => c.mainsnak.datavalue?.value.id ?? []),
            )
            break
          }
          await new Promise(r => setTimeout(r, 2_000 * attempt))
        }
      }
    }),
  )
  return order
}

async function fetchClass(category: number, cls: string) {
  const name = `${CATEGORIES[category].name}/${cls}`
  const started = Date.now()
  const results = await Promise.all([sparql(eventsQuery(cls)), sparql(subEventsQuery(cls))]).catch(err => {
    console.error(`✗ ${name}: ${err.message}`)
    return null
  })
  if (!results) return
  const [rows, parts] = results

  // [Agent] The OPTIONAL joins fan out into one row per coordinate × location × date combination, so everything folds into one item per QID, keeping the first parsed value of each field.
  const items = new Map<string, Item>()
  for (const b of rows) {
    const qid = idOf(b.e!.value)
    let item = items.get(qid)
    if (!item) {
      item = { label: b.label!.value, article: decodeURIComponent(b.article!.value.split('/wiki/')[1]), sitelinks: Number(b.sitelinks!.value), locations: new Map(), dates: {} }
      items.set(qid, item)
    }
    item.own ??= parsePoint(b.coord?.value)
    const loc = parsePoint(b.locCoord?.value)
    if (loc && b.loc) item.locations.set(idOf(b.loc.value), loc)
    item.dates.time ??= parseYear(b.time?.value)
    item.dates.start ??= parseYear(b.start?.value)
    item.dates.inception ??= parseYear(b.inception?.value)
    item.dates.end ??= parseYear(b.end?.value)
  }

  const subEvents = new Map<string, Point[]>()
  for (const b of parts) {
    const point = parsePoint(b.coord?.value)
    const qid = idOf(b.e!.value)
    if (point) subEvents.set(qid, [...(subEvents.get(qid) ?? []), point])
  }

  const listed = await firstListedLocations([...items].filter(([, it]) => it.locations.size > 1).map(([qid]) => qid))

  db.exec('BEGIN')
  for (const [qid, item] of items) {
    // [Agent] Point in time beats start, which beats inception.
    const year = item.dates.time ?? item.dates.start ?? item.dates.inception
    if (year === undefined || year < -3000 || year > 2026) continue
    const end = item.dates.end !== undefined && item.dates.end > year ? Math.min(item.dates.end, 2026) : null
    const points = subEvents.get(qid) ?? []
    const median = points.length ? medianPoint(points) : undefined
    const firstLoc = listed.get(qid)?.find(loc => item.locations.has(loc)) ?? [...item.locations.keys()][0]
    const loc = firstLoc ? item.locations.get(firstLoc) : undefined
    upsert.run(
      qid,
      item.label,
      item.article,
      category,
      year,
      end,
      item.sitelinks,
      item.own?.[0] ?? null,
      item.own?.[1] ?? null,
      median?.[0] ?? null,
      median?.[1] ?? null,
      points.length,
      loc?.[0] ?? null,
      loc?.[1] ?? null,
    )
  }
  markFetched.run(cls, items.size)
  db.exec('COMMIT')
  console.log(`✓ ${name}: ${items.size} items, ${listed.size} multi-location resolved, in ${((Date.now() - started) / 1000).toFixed(0)}s`)
}

// [Agent] Two workers: QLever is fast, and it's a shared academic service, so there's no point hammering it.
const jobs = CATEGORIES.flatMap(({ name, classes }, category) => (only.length && !only.includes(name) ? [] : classes.filter(c => refresh || !alreadyFetched.has(c)).map(cls => ({ category, cls }))))
await Promise.all(
  [0, 1].map(async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) await fetchClass(job.category, job.cls)
  }),
)

const counts = db.prepare('SELECT category, count(*) AS n FROM events GROUP BY category').all() as { category: number; n: number }[]
console.log(`\n${counts.map(r => `${CATEGORIES[r.category].name}: ${r.n}`).join('  ')}`)
