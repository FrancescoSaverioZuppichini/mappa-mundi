# Build a History Atlas from Wikipedia, from Zero

Hello There!! Today we'll build an interactive atlas of five thousand years of history: a 3D globe, a timeline you scrub through, and about 23,000 events from Wikipedia, each ranked by how many other Wikipedia articles link to it.

It's the **mini version of Mappa Mundi**, the app in this repo. It has the same structure and the same ideas, with fewer features. We build it bottom up:

1. **the data:** a pipeline that pulls events from Wikidata, measures their importance on Wikipedia, and packs everything into one Feather file of columns the browser reads without parsing;
2. **the logic:** time, ranking and the rules of the state, all pure functions you can run in the terminal;
3. **the store:** one state, one way to change it;
4. **what you see:** a MapLibre globe that decides what fits on screen, a canvas timeline, and a thin React UI.

Every code block that starts with a path (`// src/lib/time.ts`) is a complete file: create it, paste it, done. Every output shown is real, from the run I did while writing this.

Let's get started!

**Contents**

0. [The design](#0-the-design)
1. [Setup](#1-setup)
2. [What is an event? Wikidata](#2-what-is-an-event-wikidata)
3. [How important is it? In-degree](#3-how-important-is-it-in-degree)
4. [Decisions: score, position, one Feather file](#4-decisions-score-position-one-feather-file)
5. [The pure logic: time and ranking](#5-the-pure-logic-time-and-ranking)
6. [The store: one state, one writer](#6-the-store-one-state-one-writer)
7. [The globe](#7-the-globe)
8. [The timeline](#8-the-timeline)
9. [The React UI](#9-the-react-ui)
10. [Run it](#10-run-it)
11. [From the mini to the full app](#11-from-the-mini-to-the-full-app)

---

## 0. The design

Two halves, which meet at two files:

```
 OFFLINE (Node, run once)                            BROWSER

 Wikidata ──► fetch-events.ts ────┐
                                  ├──► data/history.sqlite
 Wikipedia ─► fetch-wikipedia.ts ─┘          │
                                     export-events.ts
                                             ▼
                                 public/data/events.arrow ──► the app
```

**The pipeline rule: fetch scripts record facts, the export makes decisions.**

- A fact is "this battle has these coordinates" or "this article has 1,838 incoming links".
- A decision is "which coordinate wins", "how important is it" or "do we keep it".

Downloading takes minutes and exporting takes seconds, so changing a rule means re-running only the export.

**The app rule: one state, one writer, and everything else reacts.** There's no main loop: nothing runs while you're idle.

```
input (click, drag, wheel, key) ──► update(patch) ──► apply(prev, patch) ──► new state
                                                      every rule lives here        │
                                          ┌────────────────────────────────────────┘
                                          ▼  subscribers
                     globe: re-places bubbles, follows `selected` with the camera
                     timeline canvas: redraws once per frame
                     React: the components whose slice changed re-render
                     Play loop: while playing, writes the next year back through update()
```

The folders follow that split:

```
src/
├─ main.tsx  index.css  types.ts  consts.ts
├─ hooks/useHistory.ts     the store: state + update(), and the Play loop
├─ lib/                    pure functions: time, rank, history (the rules), events (reads the file), categories, epochs
└─ components/
    ├─ App.tsx  Header.tsx  EventPanel.tsx  Surprise.tsx
    ├─ globe/              Globe.tsx + map.ts (MapLibre) + placement.ts (what fits on screen)
    └─ timeline/           Timeline.tsx + canvas.ts (the drawing)
scripts/                   the pipeline, plus two terminal checkpoints
```

`lib/` never imports React, the DOM or MapLibre. So the whole logic runs in Node, and we'll test it there before drawing anything.

## 1. Setup

You need **Node 24**: it has SQLite built in (`node:sqlite`), and it runs `.ts` files directly by stripping the types. So the pipeline needs no build step, and only one dependency, which we add in §4.

```bash
mkdir mini-atlas && cd mini-atlas
npm init -y && npm pkg set type=module
npm install maplibre-gl react react-dom zustand
npm install -D vite @vitejs/plugin-react typescript@~6.0 @types/react @types/react-dom @types/node@24 tailwindcss @tailwindcss/vite
mkdir -p scripts src/hooks src/lib src/components/globe src/components/timeline
```

**`package.json`** (the scripts are what matters; your versions may be newer)
```json
{
  "name": "mini-atlas",
  "private": true,
  "type": "module",
  "scripts": {
    "data": "node scripts/fetch-events.ts && node scripts/fetch-wikipedia.ts && node scripts/export-events.ts",
    "dev": "vite",
    "build": "tsc && vite build"
  },
  "dependencies": {
    "maplibre-gl": "^6.11.2",
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "zustand": "^5.0.15"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.3",
    "@types/node": "^24.19.0",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.1.1",
    "tailwindcss": "^4.3.3",
    "typescript": "~6.0.2",
    "vite": "^8.3.1"
  }
}
```

**`tsconfig.json`**
```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["ES2023", "DOM"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "types": ["vite/client", "node"]
  },
  "include": ["src", "scripts"]
}
```

Two flags make the same files run in Node and in the browser:

- **`allowImportingTsExtensions`.** Node needs full file names in imports (`'./time.ts'`), so we always write the extension.
- **`erasableSyntaxOnly`.** Node deletes types instead of compiling them, so TypeScript features that need compiling, like `enum`, are forbidden.

**`vite.config.ts`**
```ts
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
})
```

MapLibre parses data in a Web Worker, and that worker is an ES module, hence `worker.format`.

**`index.html`**
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Mini Atlas</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**`src/index.css`**
```css
/* src/index.css */
@import 'tailwindcss';

html,
body,
#root {
  height: 100%;
  margin: 0;
}
```

---

## 2. What is an event? Wikidata

Wikidata is the database behind Wikipedia. Every thing is an item with a **QID** (the Battle of Hastings is `Q83224`). Facts are statements "item, property, value":

| Property | Meaning | Battle of Hastings |
|---|---|---|
| `P31` / `P279` | instance of / subclass of | battle |
| `P585` | point in time | 1066 |
| `P580` / `P582` | start / end time | (wars: 1939 / 1945) |
| `P571` | inception | (cities: their founding) |
| `P625` | coordinates | 0.4875°E, 50.91°N |
| `P276` | location | Battle, East Sussex |
| `P361` | part of | Norman conquest of England |

On top of those there's the **sitelink count**: how many Wikipedia languages have an article about the item. For Hastings it's 81.

We query it in **SPARQL** through **QLever**, because the official query service times out on classes this big (there are almost 13,000 battles). You only need five pieces of SPARQL to read our queries:

- `?e wdt:P585 ?time .` is a pattern with blanks: "every `?e` with point in time `?time`".
- `;` continues with the same subject.
- `OPTIONAL { … }` keeps the row even when a pattern has no match.
- `wdt:P31/wdt:P279*` is a property path: "instance of a subclass, at any depth".
- `P361+` means "part of, one or more steps".

```bash
curl -s https://qlever.dev/api/wikidata -H 'Accept: application/sparql-results+json' --data-urlencode 'query=
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>
SELECT ?e ?sitelinks ?coord ?time WHERE {
  VALUES ?e { wd:Q83224 wd:Q31900 }
  ?e wikibase:sitelinks ?sitelinks .
  OPTIONAL { ?e wdt:P625 ?coord }
  OPTIONAL { ?e wdt:P585 ?time }
}'
```

```json
{ "results": { "bindings": [
  { "e": { "value": "http://www.wikidata.org/entity/Q31900" }, "sitelinks": { "value": "76" },
    "coord": { "value": "POINT(23.978333 38.118056)" }, "time": { "value": "-0489-09-07T00:00:00Z" } },
  { "e": { "value": "http://www.wikidata.org/entity/Q83224" }, "sitelinks": { "value": "81" },
    "coord": { "value": "POINT(0.487500 50.911945)" }, "time": { "value": "1066-10-20T00:00:00Z" } }
] } }
```

Three traps are in that answer:

1. **Marathon (490 BC) says `-0489`.** RDF counts years with a year 0, and historians don't. Every year ≤ 0 shifts down by one, or all of antiquity is off by a year.
2. **`POINT(lon lat)` puts longitude first**, as GeoJSON and MapLibre do. We use `[lon, lat]` everywhere.
3. **Every value is a string**, numbers included.

### 2.1 Which events

The generic class *occurrence* is half sports seasons and award shows. So we choose the classes that are history, each with a colour and a ranking weight (§4):

```ts
// src/lib/categories.ts
// Each category is a set of Wikidata classes. A founding is ranked by its city's article, which is mostly
// about the modern city, so its score is damped.
export const CATEGORIES = [
  { name: 'battle', color: '#d63031', weight: 1, classes: ['Q178561'] }, // battle
  { name: 'war', color: '#8e1537', weight: 1, classes: ['Q198'] }, // war
  { name: 'politics', color: '#6c5ce7', weight: 1, classes: ['Q131569', 'Q10931'] }, // treaty, revolution
  { name: 'disaster', color: '#e67e22', weight: 1, classes: ['Q8065'] }, // natural disaster
  { name: 'founding', color: '#00a887', weight: 0.15, classes: ['Q515'] }, // city, dated by its inception (P571)
]
```

An item matching several classes is kept once, with the lowest category index, so a battle stays a battle.

### 2.2 Where did it happen?

An event has up to four answers, and the fetch records all of them:

1. its own coordinates;
2. its Wikipedia article's coordinates (§3);
3. the median of its sub-events (`P361+`);
4. its location (`P276`).

Answer 3 exists because wars have no single place. In our data WWII's location came back as **15°E 0°N, in Central Africa**, and WWI's as a point in **China**. But WWII has **1,124 located sub-events** (its battles), and their median is **22.5°E 45.6°N**, the middle of the European theatre. A war is where its battles were.

- **Median, not mean.** One raid on Darwin shouldn't drag WWII towards Australia. With a median it's one vote like any other battle.
- **Longitude wraps.** The mean of 179°E and 179°W is 0°, which is Africa. So we take the circular mean first (`atan2` of the summed sines and cosines, which gives 180°), then measure every longitude relative to it before taking the median.

### 2.3 The script

The results go into SQLite. Each class is saved as soon as its query returns, so a crash loses nothing, and the export can re-read everything without touching the network. Put your email in `USER_AGENT`: Wikimedia blocks anonymous scripts.

```ts
// scripts/fetch-events.ts
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { CATEGORIES } from '../src/lib/categories.ts'

const USER_AGENT = 'mini-atlas/0.1 (you@example.com)'

mkdirSync('data', { recursive: true })
const db = new DatabaseSync('data/history.sqlite')
db.exec(`CREATE TABLE IF NOT EXISTS events (
  qid TEXT PRIMARY KEY, label TEXT, article TEXT, category INTEGER, year INTEGER, year_end INTEGER, sitelinks INTEGER,
  own_lon REAL, own_lat REAL, parts_lon REAL, parts_lat REAL, parts INTEGER, loc_lon REAL, loc_lat REAL)`)
// An item can match several classes. The lowest category index wins, so a battle stays a battle.
const upsert = db.prepare(`INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(qid) DO UPDATE SET category = min(category, excluded.category)`)

const PREFIXES = `
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX schema: <http://schema.org/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>`

const eventsQuery = (cls: string) => `${PREFIXES}
SELECT ?e ?label ?article ?sitelinks ?coord ?locCoord ?time ?start ?inception ?end WHERE {
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

const subEventsQuery = (cls: string) => `${PREFIXES}
SELECT ?e ?coord WHERE {
  ?e wdt:P31/wdt:P279* wd:${cls} .
  ?article schema:about ?e ; schema:isPartOf <https://en.wikipedia.org/> .
  ?part wdt:P361+ ?e ; wdt:P625 ?coord .
}`

type Binding = Record<string, { value: string } | undefined>
type Point = [lon: number, lat: number]

async function sparql(query: string): Promise<Binding[]> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://qlever.dev/api/wikidata', {
      method: 'POST',
      headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT },
      body: new URLSearchParams({ query }),
    })
    // Raw control characters sometimes leak into labels and break JSON.parse.
    if (res.ok) return JSON.parse((await res.text()).replace(/[\u0000-\u001f]/g, ' ')).results.bindings
    if (attempt === 3) throw new Error(`QLever ${res.status}`)
    await new Promise(r => setTimeout(r, 15_000 * attempt))
  }
}

const idOf = (iri: string) => iri.slice(iri.lastIndexOf('/') + 1)

function parsePoint(wkt?: string): Point | undefined {
  const m = wkt?.match(/^point\(([-\d.eE]+) ([-\d.eE]+)\)$/i)
  return m ? [Number(m[1]), Number(m[2])] : undefined
}

// RDF years are astronomical: year 0 is 1 BC, so Marathon (490 BC) arrives as "-0489-09-07".
function parseYear(iso?: string) {
  if (!iso || !/^-?\d+-/.test(iso)) return undefined
  const year = parseInt(iso)
  return year <= 0 ? year - 1 : year
}

// Median per coordinate, so one far-away raid can't drag a whole war. Longitudes are measured around
// their circular mean first, so a Pacific campaign that straddles ±180° doesn't average out to Africa.
function medianPoint(points: Point[]): Point {
  const middle = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1]
  const rad = Math.PI / 180
  const ref = Math.atan2(points.reduce((s, [lon]) => s + Math.sin(lon * rad), 0), points.reduce((s, [lon]) => s + Math.cos(lon * rad), 0)) / rad
  const lon = ref + middle(points.map(([lon]) => ((lon - ref + 540) % 360) - 180))
  return [((lon + 540) % 360) - 180, middle(points.map(([, lat]) => lat))]
}

for (const [category, { name, classes }] of CATEGORIES.entries()) {
  for (const cls of classes) {
    const [rows, parts] = await Promise.all([sparql(eventsQuery(cls)), sparql(subEventsQuery(cls))])

    // The OPTIONALs fan out into one row per combination, so fold them into one item per QID.
    const items = new Map<string, { label: string; article: string; sitelinks: number; own?: Point; loc?: Point; time?: number; start?: number; inception?: number; end?: number }>()
    for (const b of rows) {
      const qid = idOf(b.e!.value)
      const item = items.get(qid) ?? { label: b.label!.value, article: decodeURIComponent(b.article!.value.split('/wiki/')[1]), sitelinks: Number(b.sitelinks!.value) }
      items.set(qid, item)
      item.own ??= parsePoint(b.coord?.value)
      item.loc ??= parsePoint(b.locCoord?.value)
      item.time ??= parseYear(b.time?.value)
      item.start ??= parseYear(b.start?.value)
      item.inception ??= parseYear(b.inception?.value)
      item.end ??= parseYear(b.end?.value)
    }
    const subEvents = new Map<string, Point[]>()
    for (const b of parts) {
      const point = parsePoint(b.coord?.value)
      if (point) subEvents.set(idOf(b.e!.value), [...(subEvents.get(idOf(b.e!.value)) ?? []), point])
    }

    db.exec('BEGIN')
    for (const [qid, it] of items) {
      // A start date beats a point in time: World War I carries both, 1914 and 1918.
      const year = it.start ?? it.time ?? it.inception
      if (year === undefined || year < -3000 || year > 2026) continue
      const end = it.end !== undefined && it.end > year ? Math.min(it.end, 2026) : null
      const points = subEvents.get(qid) ?? []
      const median = points.length ? medianPoint(points) : undefined
      upsert.run(qid, it.label, it.article, category, year, end, it.sitelinks, it.own?.[0] ?? null, it.own?.[1] ?? null,
        median?.[0] ?? null, median?.[1] ?? null, points.length, it.loc?.[0] ?? null, it.loc?.[1] ?? null)
    }
    db.exec('COMMIT')
    console.log(`✓ ${name} ${cls}: ${items.size} items`)
  }
}
```

- **Folding.** Every `OPTIONAL` multiplies rows: 2 coordinates × 3 locations × 2 dates is 12 rows for one event. So rows fold into one item per QID, keeping the first value of each field.
- **`start ?? time ?? inception`.** World War I has both a start (1914) and a point in time (1918). The start must win, or WWI becomes a 1918 event.
- **The upsert** (`ON CONFLICT … min(category)`) is "lowest category wins" in one line of SQL.

```
✓ battle Q178561: 12842 items
✓ war Q198: 1986 items
✓ politics Q131569: 3004 items
✓ politics Q10931: 155 items
✓ disaster Q8065: 3391 items
✓ founding Q515: 29556 items
```

```bash
sqlite3 data/history.sqlite "SELECT label, year, year_end, parts FROM events WHERE label IN ('World War I', 'World War II', 'Battle of Hastings')"
```

```
Battle of Hastings|1066||0
World War I|1914|1918|604
World War II|1939|1945|1124
```

---

## 3. How important is it? In-degree

The core idea of the app: **an event is as important as the number of Wikipedia articles linking to it.** 1,838 English articles link to the Battle of Hastings. Editors link to what matters, so this *in-degree* works surprisingly well.

Wikipedia's search engine (CirrusSearch) stores it per page as `incoming_links`, and the API can return it together with the article's coordinates:

```bash
curl -s 'https://en.wikipedia.org/w/api.php?action=query&prop=cirrusdoc|coordinates&cdincludes=incoming_links&coprimary=primary&colimit=max&titles=Battle_of_Hastings|Battle_of_Marathon&format=json&formatversion=2'
```

```json
{ "query": {
  "normalized": [{ "from": "Battle_of_Hastings", "to": "Battle of Hastings" }, …],
  "pages": [
    { "title": "Battle of Marathon", "cirrusdoc": [{ "source": { "incoming_links": 895 } }],
      "coordinates": [{ "lat": 38.11805556, "lon": 23.97833333, "primary": true }] },
    { "title": "Battle of Hastings", "cirrusdoc": [{ "source": { "incoming_links": 1838 } }] }
  ] } }
```

The parameters that bite:

- **`cdincludes=incoming_links`** returns one field instead of the whole search document: 24 KB per request instead of 2.5 MB.
- **`colimit=max`**: coordinates default to 10 pages per request, so with 50 titles, 40 silently get none.
- **`normalized`**: titles come back with spaces. We stored underscores, so we map the answers back.
- **Politeness:** 4 requests in flight, and on `429` we wait exactly the `Retry-After` time.

```ts
// scripts/fetch-wikipedia.ts
import { DatabaseSync } from 'node:sqlite'

const USER_AGENT = 'mini-atlas/0.1 (you@example.com)'
const db = new DatabaseSync('data/history.sqlite')
db.exec('CREATE TABLE IF NOT EXISTS articles (article TEXT PRIMARY KEY, inlinks INTEGER, lon REAL, lat REAL)')
const save = db.prepare('INSERT OR REPLACE INTO articles VALUES (?, ?, ?, ?)')
// Only articles we don't have yet, so a crashed run just continues.
const pending = (db.prepare('SELECT DISTINCT article FROM events WHERE article NOT IN (SELECT article FROM articles)').all() as { article: string }[]).map(r => r.article)

type Page = { title: string; cirrusdoc?: { source: { incoming_links?: number } }[]; coordinates?: { lat: number; lon: number }[] }
type Body = { query?: { normalized?: { from: string; to: string }[]; pages: Page[] } }

async function fetchBatch(titles: string[]) {
  const params = new URLSearchParams({
    action: 'query', prop: 'cirrusdoc|coordinates', cdincludes: 'incoming_links',
    coprimary: 'primary', colimit: 'max', titles: titles.join('|'), format: 'json', formatversion: '2',
  })
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { headers: { 'User-Agent': USER_AGENT } })
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, (Number(res.headers.get('retry-after')) || 20) * 1000))
      continue
    }
    const body = (await res.json()) as Body
    if (!body.query) continue
    // The API answers with normalised titles ("Battle of Hastings"), and we stored "Battle_of_Hastings".
    const stored = new Map(titles.map(t => [t, t]))
    for (const { from, to } of body.query.normalized ?? []) stored.set(to, from)
    db.exec('BEGIN')
    for (const page of body.query.pages) {
      const coord = page.coordinates?.[0]
      save.run(stored.get(page.title) ?? page.title, page.cirrusdoc?.[0]?.source.incoming_links ?? 0, coord?.lon ?? null, coord?.lat ?? null)
    }
    db.exec('COMMIT')
    return
  }
}

console.log(`${pending.length} articles to fetch`)
const batches = Array.from({ length: Math.ceil(pending.length / 50) }, (_, i) => pending.slice(i * 50, i * 50 + 50))
await Promise.all([1, 2, 3, 4].map(async () => {
  for (let batch = batches.shift(); batch; batch = batches.shift()) await fetchBatch(batch)
}))
console.log('✓ done')
```

"4 at a time" is four loops pulling from one shared list with `batches.shift()`. The script only asks for articles it doesn't have yet, so if it dies, run it again. With 29,078 articles that's 582 requests:

```
29078 articles to fetch
✓ done
```

---

## 4. Decisions: score, position, one Feather file

### 4.1 The score, and the template trap

In-degree has one ugly failure mode: **navigation templates.** A navbox, the box of links at the bottom of an article, is copied onto every article in its group. So an article inside a navbox used on 40,000 pages gets 40,000 "links". Real examples from the full dataset:

| Article | In-degree | Languages | in-degree ÷ languages^1.5 |
|---|---:|---:|---:|
| World War II | 217,991 | 291 | 44 |
| French Revolution | 15,567 | 195 | 6 |
| 2017 Bishop International Airport incident | **41,750** | **2** | **14,761** |

Truly important events exist in many languages, and inflated ones don't. So:

```
score = min(inlinks, 60 × sitelinks^1.5) × categoryWeight
```

Why 1.5? Real events stay under about 55 in the last column. With an exponent of 1, the cap would cut WWII from 217,991 links to 17,460. With 2, an inflated article in 20 languages could keep 24,000 fake links. With 1.5, WWII is untouched and the airport incident is capped at 170.

The category weight fixes another bias. London's 178,620 links are about modern London, not its founding in 47 AD, so foundings count ×0.15. Articles with fewer than 10 links are dropped.

### 4.2 The file

For each event the browser needs a position, a start, an end, a score, an in-degree, a category and three strings. JSON objects would be slow to parse and create 23,000 objects nobody needs. So we store **columns**: all the starts together, then all the ends, all the longitudes, and so on, each one written exactly as a `Float32Array` sits in memory. The browser then never parses a number. It points a typed-array view at each column's bytes: **reading is pointing, not parsing.**

That is what **Feather** is: Apache Arrow's IPC format, written as a file. Every column is one block of raw, aligned bytes, and a footer records where each block starts:

```
public/data/events.arrow
  ARROW1         magic bytes
  schema         qid · label · article: utf8   category: dictionary   start · end · lon · lat · score · inlinks: float32
  dictionary     battle · war · politics · disaster · founding
  record batch   every column's raw bytes, each block starting on a multiple of 8
                 … │ start f32 × n │ end f32 × n │ lon f32 × n │ lat f32 × n │ score f32 × n │ inlinks f32 × n │
  footer         where every block starts
  ARROW1
```

- **Reading is pointing.** `tableFromIPC` reads the footer, learns "`lon` is float32 and starts at byte X", and hands back `new Float32Array(bytes.buffer, X, n)`. No number is decoded and nothing is copied.
- **Alignment is the format's job.** A `Float32Array` must start on a multiple of 4 bytes, and Feather pads every block to 8, so we never count offsets by hand.
- **f32 is enough.** It stores coordinates to about a metre and every year exactly. f64 would double the numbers for nothing.
- **Strings** are UTF-8 bytes plus offsets, and they're the only real decoding work: a JS string can't be a view.
- **`category` is dictionary-encoded.** The five names are stored once and each row costs one byte, so the file says "battle" to pandas or DuckDB, and the app maps names back to `CATEGORIES` indices when it loads.
- **The key decision: rows are sorted by score, most important first.** Row 0 is the most important event in history, and every algorithm below walks from the top.

We keep the file uncompressed so the views point straight into the fetched bytes; the full app adds ZSTD, which makes it about 3× smaller at the price of unzipping each column once. The same trick hand-rolled, with its traps, is in [docs/zero-copy.md](docs/zero-copy.md).

Feather needs one library, [flechette](https://github.com/uwdata/flechette), a small Arrow implementation in JavaScript. The browser uses it too, so it's a regular dependency:

```bash
npm install @uwdata/flechette
```

```ts
// scripts/export-events.ts
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dictionary, int8, tableFromArrays, tableToIPC, utf8 } from '@uwdata/flechette'
import { CATEGORIES } from '../src/lib/categories.ts'

const MIN_INLINKS = 10
const TEMPLATE_CAP = 60

type Row = {
  qid: string; label: string; article: string; category: number; year: number; year_end: number; sitelinks: number; inlinks: number
  own_lon: number | null; own_lat: number | null; article_lon: number | null; article_lat: number | null
  parts: number; parts_lon: number | null; parts_lat: number | null; loc_lon: number | null; loc_lat: number | null
}

// [Agent] The first position that exists wins.
function position(r: Row): [number, number] | null {
  if (r.own_lon !== null && r.own_lat !== null) return [r.own_lon, r.own_lat]
  if (r.article_lon !== null && r.article_lat !== null) return [r.article_lon, r.article_lat]
  if (r.parts >= 2 && r.parts_lon !== null && r.parts_lat !== null) return [r.parts_lon, r.parts_lat]
  if (r.loc_lon !== null && r.loc_lat !== null) return [r.loc_lon, r.loc_lat]
  return null
}

const db = new DatabaseSync('data/history.sqlite', { readOnly: true })
const rows = db.prepare(`
  SELECT e.*, coalesce(e.year_end, e.year) AS year_end, a.inlinks, a.lon AS article_lon, a.lat AS article_lat
  FROM events e JOIN articles a USING (article) WHERE a.inlinks >= ${MIN_INLINKS}`).all() as Row[]

const events = rows
  .flatMap(r => {
    const at = position(r)
    const score = Math.min(r.inlinks, TEMPLATE_CAP * r.sitelinks ** 1.5) * CATEGORIES[r.category].weight
    return at ? [{ ...r, lon: at[0], lat: at[1], score }] : []
  })
  .sort((a, b) => b.score - a.score)

// [Agent] One array per column, all in the same row order. A Float32Array becomes a float32 column as it is, so the
// browser gets the very same bytes back. Plain arrays need a type: strings are utf8, and category goes in by name
// as a dictionary, so the file reads "battle" anywhere while each row still costs one byte.
const table = tableFromArrays(
  {
    qid: events.map(e => e.qid),
    label: events.map(e => e.label),
    article: events.map(e => e.article),
    category: events.map(e => CATEGORIES[e.category].name),
    start: Float32Array.from(events, e => e.year),
    end: Float32Array.from(events, e => e.year_end),
    lon: Float32Array.from(events, e => e.lon),
    lat: Float32Array.from(events, e => e.lat),
    score: Float32Array.from(events, e => e.score),
    inlinks: Float32Array.from(events, e => e.inlinks),
  },
  { types: { qid: utf8(), label: utf8(), article: utf8(), category: dictionary(utf8(), int8()) } },
)

// [Agent] format 'file' is Feather: the columns plus the footer that says where each one starts. No codec, so the
// bytes on disk are exactly the bytes the browser will view. It returns null only when given a sink, hence the `!`.
const bytes = tableToIPC(table, { format: 'file' })!
mkdirSync('public/data', { recursive: true })
writeFileSync('public/data/events.arrow', bytes)
console.log(`✓ ${events.length} events, ${(bytes.byteLength / 1e6).toFixed(1)} MB. Top: ${events.slice(0, 5).map(e => e.label).join(' · ')}`)
```

```
✓ 22778 events, 1.8 MB. Top: World War II · World War I · American Civil War · Bangladesh Liberation War · New York City
```

The six number columns are 0.55 MB of that, and the three string columns are most of the rest. A server that sends it with brotli gets it down to 0.59 MB, and the browser undoes that before `arrayBuffer()` hands over the bytes, so the views still point at plain columns.

The whole pipeline took 9 minutes, most of it the Wikipedia step. `npm run data` runs all three scripts.

---

## 5. The pure logic: time and ranking

### 5.1 The shared shapes and numbers

```ts
// src/types.ts
export type EventsData = {
  count: number
  qid: string[]
  label: string[]
  article: string[]
  category: Uint8Array
  start: Float32Array
  end: Float32Array
  lon: Float32Array
  lat: Float32Array
  score: Float32Array
  inlinks: Float32Array
}

export type TimeWindow = [start: number, end: number]

export type HistoryState = {
  time: { year: number; span: number }
  selected: number | null
  view: { detail: number }
  play: { on: boolean; speed: number; explore: boolean }
  drawn: { shown: number; population: number; minInlinks: number }
}

// What update() takes: any fields, and within a group only the ones that change.
export type HistoryPatch = {
  time?: Partial<HistoryState['time']>
  selected?: number | null
  view?: Partial<HistoryState['view']>
  play?: Partial<HistoryState['play']>
  drawn?: HistoryState['drawn']
}

export type HistoryStore = HistoryState & { update: (patch: HistoryPatch) => void }
```

```ts
// src/consts.ts
import type { HistoryState } from './types.ts'

export const YEAR_MIN = -3000
export const YEAR_MAX = 2026
export const SPANS = [1, 10, 25, 50, 100, 500]
export const PLAY_SPEEDS = [1, 2, 5, 10, 25, 50, 100]
// Play opens a new headline at most this often, so each one stays up long enough to read.
export const HEADLINE_EVERY_MS = 3500
// Surprise me draws from the most important few thousand: famous enough to have a story, not always the same ten.
export const SURPRISE_POOL = 3000

export const DEFAULTS: HistoryState = {
  time: { year: 1750, span: 100 },
  selected: null,
  view: { detail: 120 },
  play: { on: false, speed: 10, explore: true },
  drawn: { shown: 0, population: 0, minInlinks: 0 },
}
```

### 5.2 Time

On a linear bar from 3000 BC to 2026, the 20th century would get 2% of the width and antiquity 60%, while the events are spread the other way round. So the bar position `t`, from 0 on the left to 1 on the right, is the **log of "years before today"**:

```
t(year) = (ln(5176) − ln(2026 − year + 150)) / (ln(5176) − ln(150))
```

- `2026 − year` is "years before today".
- `+150` (`K`) keeps today off infinity, since ln(0) = −∞.
- `5176` is 2026 − (−3000) + 150, the value for 3000 BC, so that year lands exactly on t = 0.

| Year | 3000 BC | 1000 BC | 1 AD | 1000 | 1500 | 1800 | 1900 | 2000 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| **t, log** | 0.000 | 0.138 | 0.245 | 0.418 | 0.575 | 0.740 | 0.828 | 0.955 | 1.000 |
| t, linear | 0.000 | 0.398 | 0.597 | 0.796 | 0.895 | 0.955 | 0.975 | 0.995 | 1.000 |

On the log bar, the two millennia before 1 AD get a quarter of the width, and so do the last two centuries. `K` is the dial that sets that balance:

| K | the last 10 years get | antiquity gets | the last 200 years get |
|---:|---:|---:|---:|
| 10 | 11.1% | 15% | 49% |
| **150** | **1.8%** | **24%** | **24%** |
| 1000 | 0.6% | 38% | 10% |

With 150, antiquity and the last two centuries get a quarter of the bar each, which is roughly how the events are spread.

The state stores the **playhead year and a span**, and the window of shown events is derived with `windowOf`:

```ts
windowOf({ year: 1066, span: 100 })   // [1016, 1116]
windowOf({ year: 1942, span: 500 })   // [1692, 2026]   ← cut off at today, not slid back
```

Why cut off and not slide back to [1526, 2026]? The borders and the map colours follow the playhead. If the window slid, pressing 500 in 1942 would move you to 1776, and you'd see the 18th-century world under WWII bubbles.

```ts
// src/lib/time.ts
import { YEAR_MAX, YEAR_MIN } from '../consts.ts'
import type { TimeWindow } from '../types.ts'

const K = 150
const FAR = Math.log(YEAR_MAX - YEAR_MIN + K)
const NEAR = Math.log(K)

// Position on the timeline bar (0..1) is the log of "years before today". K keeps today off infinity.
export const yearToT = (year: number) => (FAR - Math.log(YEAR_MAX - year + K)) / (FAR - NEAR)
export const tToYear = (t: number) => YEAR_MAX + K - Math.exp(FAR - t * (FAR - NEAR))

// The years whose events are shown: span years around the playhead, cut off at either end of history.
export function windowOf({ year, span }: { year: number; span: number }): TimeWindow {
  return [Math.max(YEAR_MIN, year - span / 2), Math.min(YEAR_MAX, year + span / 2)]
}

// Our years skip zero the way historians count: -1 is 1 BC.
export function formatYear(year: number) {
  const y = Math.round(year)
  return y < 0 ? `${-y} BC` : y < 1000 ? `${Math.max(y, 1)} AD` : `${y}`
}
```

Reading the file is a pure function too, so the terminal scripts and the browser share it. Node's `readFileSync` gives a `Buffer`, which is a `Uint8Array`, and `fetch` gives an `ArrayBuffer`: `tableFromIPC` takes either.

```ts
// src/lib/events.ts
import { tableFromIPC } from '@uwdata/flechette'
import type { EventsData } from '../types.ts'
import { CATEGORIES } from './categories.ts'

// [Agent] tableFromIPC reads the footer and hands every number column back as a Float32Array over the file's own
// bytes, so nothing is parsed or copied. Only the strings are decoded. The columns come back untyped, and the cast
// trusts export-events.ts to have written what EventsData says.
export function parseEvents(bytes: ArrayBuffer | Uint8Array): EventsData {
  const table = tableFromIPC(bytes)
  const { category, ...columns } = table.toColumns()
  return {
    ...columns,
    count: table.numRows,
    // [Agent] The file names categories and the app indexes CATEGORIES. A name we don't know means the file and the
    // code disagree, and that has to fail here instead of quietly drawing it as a battle.
    category: Uint8Array.from(category, (name: string) => {
      const id = CATEGORIES.findIndex(c => c.name === name)
      if (id < 0) throw new Error(`events.arrow has an unknown category: ${name}`)
      return id
    }),
  } as EventsData
}
```

```ts
// src/lib/epochs.ts
export type EpochConfig = { name: string; from: number; sea: string; land: string; border: string; ink: string }

export const EPOCHS: EpochConfig[] = [
  { name: 'Antiquity', from: -3000, sea: '#cdb98f', land: '#efe2c4', border: '#8a6a44', ink: '#3b2a1a' },
  { name: 'Middle Ages', from: 500, sea: '#34506f', land: '#f2e7cd', border: '#b08d3c', ink: '#2b1b12' },
  { name: 'Age of Sail', from: 1500, sea: '#d7cfb8', land: '#f6efdc', border: '#8b3a2b', ink: '#2d2a26' },
  { name: 'Modern', from: 1900, sea: '#0f1c2b', land: '#23344a', border: '#6fd3f5', ink: '#e8ecf1' },
]

export const epochAt = (year: number) => EPOCHS.findLast(e => e.from <= year) ?? EPOCHS[0]
```

### 5.3 What matters in a moment

Rank the window 150–250 AD by plain score and you get:

```
Zurich (200)                       2070
Newcastle upon Tyne (200)          1614
Roman–Persian Wars (54 BC–628)     1105    ← near the top of every window for 700 years
Marcomannic Wars (166–180)          705
```

So an event's score is **spread over the years it lasted**, and a window gets its share:

```
share        = (years inside the window + 1) / (years it lasted + 1)
window score = score × share
```

- A battle keeps its full score.
- The Roman–Persian Wars get 101 / 683 = 0.148 of 150–250, which is 163, so they drop out of the top 5.
- Over 500 BC–500 AD they get 0.81 and matter again: the ranking follows the scale you look at.

`rank` filters the window and sorts by window score. The map, the timeline and Play ask for the same window in the same frame, so it keeps its last answer.

```ts
// src/lib/rank.ts
import type { EventsData, TimeWindow } from '../types.ts'

// An event's score is spread over the years it lasted. A window gets the share it covers.
export function shareOf(events: EventsData, i: number, [start, end]: TimeWindow) {
  const overlap = Math.min(events.end[i], end) - Math.max(events.start[i], start)
  return (Math.max(0, overlap) + 1) / (events.end[i] - events.start[i] + 1)
}

// The window's events, most important first by score × share. The map, the timeline and Play ask for the
// same window in the same frame, so the last answer is kept and handed back when the question repeats.
let last: { start: number; end: number; ranked: number[] } | null = null
export function rank(events: EventsData, window: TimeWindow): number[] {
  const [start, end] = window
  if (last?.start === start && last.end === end) return last.ranked
  const inView: number[] = []
  for (let i = 0; i < events.count; i++) if (events.start[i] <= end && events.end[i] >= start) inView.push(i)
  const score = (i: number) => events.score[i] * shareOf(events, i, window)
  last = { start, end, ranked: inView.sort((a, b) => score(b) - score(a)) }
  return last.ranked
}
```

**Checkpoint.** Ask the ranking about any moment:

```ts
// scripts/explore.ts
import { readFileSync } from 'node:fs'
import { parseEvents } from '../src/lib/events.ts'
import { rank, shareOf } from '../src/lib/rank.ts'
import { formatYear, windowOf } from '../src/lib/time.ts'

const [year = '1066', span = '100'] = process.argv.slice(2)
const events = parseEvents(readFileSync('public/data/events.arrow'))

const timeWindow = windowOf({ year: Number(year), span: Number(span) })
const ranked = rank(events, timeWindow)
console.log(`${formatYear(timeWindow[0])} – ${formatYear(timeWindow[1])}: ${ranked.length} events, headline: ${events.label[ranked[0]]}`)
for (const i of ranked.slice(0, 8))
  console.log(`  ${formatYear(events.start[i]).padEnd(8)} ${events.label[i].slice(0, 36).padEnd(37)} score ${String(Math.round(events.score[i])).padStart(6)} × share ${shareOf(events, i, timeWindow).toFixed(2)}`)
```

The `Buffer` goes in as it is. A small one can be a slice of a bigger shared pool, the [classic trap](docs/zero-copy.md#the-node-buffer-trap) of hand-made formats, but flechette reads from its `byteOffset`, so there's nothing to slice.

```
$ node scripts/explore.ts 1066 100
1016 – 1116: 232 events, headline: Oslo
  1048     Oslo                                  score   3183 × share 1.00
  1096     First Crusade                         score   2454 × share 1.00
  1081     Cardiff                               score   2273 × share 1.00
  1066     Battle of Hastings                    score   1838 × share 1.00
  1094     Zagreb                                score   1583 × share 1.00
  1101     Kingston upon Hull                    score   1400 × share 1.00
  1070     Bergen                                score    958 × share 1.00
  1095     Crusades                              score   8405 × share 0.11

$ node scripts/explore.ts 1942 10
1937 – 1947: 1209 events, headline: World War II
  1939     World War II                          score 217991 × share 1.00
  1936     Spanish Civil War                     score  11925 × share 0.75
  1941     Attack on Pearl Harbor                score   8094 × share 1.00
  1937     Second Sino-Japanese War              score   7822 × share 1.00
  1944     Normandy landings                     score   7168 × share 1.00
  1941     Eastern Front                         score   6533 × share 1.00
  1940     Battle of France                      score   6330 × share 1.00
  1945     surrender of Japan                    score   4917 × share 1.00

$ node scripts/explore.ts 200 100
150 AD – 250 AD: 78 events, headline: Zurich
  200 AD   Zurich                                score   2070 × share 1.00
  200 AD   Newcastle upon Tyne                   score   1614 × share 1.00
  166 AD   Marcomannic Wars                      score    705 × share 1.00
  184 AD   Yellow Turban Rebellion               score    666 × share 1.00
  208 AD   Battle of Red Cliffs                  score    619 × share 1.00
  202 AD   Bursa                                 score    327 × share 1.00
  146 AD   Civil War of Wa                       score    349 × share 0.91
  200 AD   Battle of Guandu                      score    268 × share 1.00
```

- **1016–1116:** the Crusades (1095–1291) get only 11% of this window, so they come 8th despite the biggest score of the century.
- **1937–1947:** the Spanish Civil War sticks out by a year and gets 3/4 of its score.
- **Oslo and Zurich lead** because foundings are damped, not removed. That's the dial in `categories.ts`.

---

## 6. The store: one state, one writer

### 6.1 The rules, as one pure function

Every rule of the app lives in `apply(prev, patch)`:

- A patch names only what changes: `{ time: { span: 25 } }`.
- A group (`time`, `view`, `play`) is replaced only when the patch touches it. So a component reading `time` doesn't re-render when `view` changes, and "did it change?" is a cheap `!==` everywhere.
- **Opening an event takes you to its time.** Moving time off the open event closes it.
- Picking an event stops Play, unless the patch keeps Play on (Play's own loop does).
- Play starts from the moment itself, so starting it clears the selection.

```ts
// src/lib/history.ts
import { YEAR_MAX, YEAR_MIN } from '../consts.ts'
import type { EventsData, HistoryState, HistoryPatch } from '../types.ts'
import { windowOf } from './time.ts'

// Every rule of the app, as one pure function: the next state from the previous one and a patch.
// A group is replaced only when the patch touches it, so a component reading `time` doesn't re-render when `view` changes.
export function apply(events: EventsData, prev: HistoryState, patch: HistoryPatch): HistoryState {
  const next: HistoryState = {
    ...prev,
    ...patch,
    time: patch.time ? { ...prev.time, ...patch.time } : prev.time,
    view: patch.view ? { ...prev.view, ...patch.view } : prev.view,
    play: patch.play ? { ...prev.play, ...patch.play } : prev.play,
  }
  if (patch.time) next.time = { year: Math.min(Math.max(next.time.year, YEAR_MIN), YEAR_MAX), span: Math.min(Math.max(next.time.span, 1), YEAR_MAX - YEAR_MIN) }
  const inView = (i: number) => {
    const [start, end] = windowOf(next.time)
    return events.start[i] <= end && events.end[i] >= start
  }
  // Opening an event takes you to its time. Moving time off the open event closes it.
  if (patch.selected != null && !inView(patch.selected)) next.time = { ...next.time, year: events.start[patch.selected] }
  if (next.selected !== null && !inView(next.selected)) next.selected = null
  // Picking an event stops Play, unless the patch keeps it on (Play's own loop does).
  if ('selected' in patch && !patch.play && next.play.on) next.play = { ...next.play, on: false }
  // Play starts from the moment itself, not from whatever was open.
  if (next.play.on && !prev.play.on) next.selected = null
  return next
}
```

**Checkpoint.** The rules on real data, before any UI exists:

```ts
// scripts/check-rules.ts
import { readFileSync } from 'node:fs'
import { DEFAULTS } from '../src/consts.ts'
import { parseEvents } from '../src/lib/events.ts'
import { apply } from '../src/lib/history.ts'
import type { HistoryState } from '../src/types.ts'

const events = parseEvents(readFileSync('public/data/events.arrow'))
const show = (step: string, s: HistoryState) => console.log(step.padEnd(34), JSON.stringify({ time: s.time, selected: s.selected === null ? null : events.label[s.selected], play: s.play.on }))

const hastings = events.label.indexOf('Battle of Hastings')
let s = DEFAULTS
show('start', s)
s = apply(events, s, { selected: hastings })
show('open Hastings (outside 1700-1800)', s)
s = apply(events, s, { time: { year: 1500 } })
show('move time to 1500', s)
s = apply(events, s, { play: { on: true } })
show('press play', s)
s = apply(events, s, { selected: hastings })
show('open Hastings while playing', s)
```

```
start                              {"time":{"year":1750,"span":100},"selected":null,"play":false}
open Hastings (outside 1700-1800)  {"time":{"year":1066,"span":100},"selected":"Battle of Hastings","play":false}
move time to 1500                  {"time":{"year":1500,"span":100},"selected":null,"play":false}
press play                         {"time":{"year":1500,"span":100},"selected":null,"play":true}
open Hastings while playing        {"time":{"year":1066,"span":100},"selected":"Battle of Hastings","play":false}
```

### 6.2 The store

`useHistory` is a zustand store, typed as `HistoryStore`:

- **The state and `update` live together**, like `[history, setHistory]`.
- **`update` is `set(prev => apply(…))`.**
- **Components read a slice** (`useHistory(s => s.time)`) and re-render only when it changes.
- **Code that isn't React** (the map, the canvas, the Play loop) uses `getState()` and `subscribe()`, because it can't call hooks.

That's also why the state lives outside React at all. Dragging the timeline changes `time` on every frame. In a `useState` provider, every component would re-render each frame. Here only the ones reading `time` do, and the map and the canvas never re-render React.

The data loads here with a top-level `await`, so nothing renders before it's ready. It's one `fetch` and one `parseEvents`: the browser hands over the file's bytes, and the columns are views over them.

Play is the one thing that runs by itself:

- when `play.on` turns true, a `requestAnimationFrame` loop starts;
- each frame writes `year + speed × seconds elapsed` back through `update()`, using real time so the speed is the same on a 60 Hz and a 120 Hz screen;
- with explore on, when the window's top event changes (at most every 3.5 s), it opens.

```ts
// src/hooks/useHistory.ts
import { create } from 'zustand'
import { DEFAULTS, HEADLINE_EVERY_MS, YEAR_MAX } from '../consts.ts'
import { parseEvents } from '../lib/events.ts'
import { apply } from '../lib/history.ts'
import { rank } from '../lib/rank.ts'
import { windowOf } from '../lib/time.ts'
import type { HistoryStore } from '../types.ts'

async function loadEvents() {
  const res = await fetch('/data/events.arrow')
  // [Agent] In dev a missing file isn't a 404: Vite answers with index.html, and Arrow would choke on that with
  // "Expected to read 1868833084 metadata bytes". Say what's actually wrong.
  if (!res.ok || res.headers.get('content-type')?.includes('html')) throw new Error('No public/data/events.arrow: run npm run data')
  return parseEvents(await res.arrayBuffer())
}

export const events = await loadEvents()

// The store: the state, and update(), the only way to change it.
export const useHistory = create<HistoryStore>()(set => ({
  ...DEFAULTS,
  update: patch => set(prev => apply(events, prev, patch)),
}))

// Play, the one thing that runs by itself. It reacts to play.on and writes back through update().
const { update } = useHistory.getState()
let frame = 0
useHistory.subscribe((s, prev) => {
  if (!s.play.on || prev.play.on) return
  cancelAnimationFrame(frame)
  let last = performance.now()
  let lastOpened = -Infinity
  frame = requestAnimationFrame(function step(now) {
    const { time, play, selected } = useHistory.getState()
    if (!play.on) return
    const year = time.year + (play.speed * (now - last)) / 1000
    last = now
    if (year >= YEAR_MAX) return update({ play: { on: false } })
    const top = rank(events, windowOf({ ...time, year }))[0]
    const opens = play.explore && top !== undefined && top !== selected && now - lastOpened > HEADLINE_EVERY_MS
    if (opens) lastOpened = now
    update({ time: { year }, ...(opens && { selected: top, play: {} }) })
    frame = requestAnimationFrame(step)
  })
})
```

Who reads and writes what:

| Who | Reads | Writes |
|---|---|---|
| `Header` | `time`, `view.detail`, `drawn` | `update({ time: { span } })`, `update({ view: { detail } })` |
| `EventPanel` | `selected` | `update({ selected: null })` |
| `Timeline` (+ `canvas.ts`) | `play`, `time`, `selected`, `rank()` | `update({ play })`, `update({ time: { year } })`, `update({ selected })` |
| `Globe` (+ `map.ts`) | `time`, `selected`, `view`, `rank()` | `update({ selected })` on click, `update({ drawn })` after drawing |

---

## 7. The globe

### 7.1 MapLibre in brief

A MapLibre map is a **style**: `sources` (ours are all GeoJSON: land, borders, events) and `layers` drawn bottom to top (`background` for the sea, `fill`, `line`, `circle`, `symbol` for text). Values can be expressions that read each feature: `'circle-radius': ['get', 'radius']`. So we compute every size, colour and label in TypeScript, put them on the features, and the GPU draws them. `projection: { type: 'globe' }` makes it a sphere.

### 7.2 Level of detail

At the start, 1700–1800 holds 2,146 events. Drawn all at once, Europe is a red smear. MapLibre could hide overlaps, but it doesn't know the French Revolution beats a small siege, and its choices change as the globe turns, so things flicker. So `placeEvents` decides. It's pure, and sees only a `Viewport`: a size, a zoom, and "where is this lon/lat on screen?".

**1. Pool: zoom in, see more.** Only the top of the window's ranking competes: `pool = min(population, max(population × min(1, 0.3 × 2^(zoom − 1.8)), 3 × target))`.

- At zoom 1.8 the top 30% compete, and every zoom level doubles that share. So **zooming in lowers the bar**, and smaller events appear only when you look closely.
- `target` is the Detail slider (120 at the start), the most bubbles the screen may hold.
- The `3 × target` minimum keeps quiet eras full: 150–250 AD has only 78 events, so all of them compete.

Measured in the running app, over Europe in 1700–1800 (2,146 events):

| View | Bubbles shown | Smallest in-degree shown |
|---|---:|---:|
| zoom 1.6, the start | 42 | 194 links |
| zoom 2.6 | 101 | 100 links |
| zoom 3.6 | 120 (the Detail target) | 100 links |
| zoom 3.6, Detail raised to 400 | 256 | 32 links |

Zooming in brings in the long tail until the screen is as busy as Detail allows, and Detail lets it go further.

**2. Order.** First the open event, then the events already on screen, then newcomers, each group in rank order. A shown event stays while it fits, instead of being pushed out by a neighbour sliding into view: that's what stops blinking.

**3. Greedy fit.** Take each candidate once, in order. Keep its bubble if the box overlaps nothing kept so far, and give it a label while fewer than 30 are placed and the label box fits.

- Boxes go into a grid of 64 px cells, so each test only checks its neighbours.

**Normalized per span.** Nothing on screen is measured against all of history, only against the window you selected:

1. **The ranking** is by share of the window (§5.3).
2. **The pool** is a share of the *window's* event count. So a 150-link event competes in 1016–1116 (232 events, all compete), but not in 1700–1800 (2,146 events, the top 561 compete).
3. **Bubble size** comes from the rank *within the window*: `radius = 3 + 7 × percentile³`, where percentile = 1 − rank ÷ events in the window.

The effect on sizes, computed from the data:

| Window | Top event, always 10 px | Another event |
|---|---|---|
| 540–440 BC | Delhi, 17,402 links | Battle of Marathon, 895 links: rank 6 of 58 → 8.3 px |
| 1016–1116 | Oslo, 21,220 links | Battle of Hastings, 1,838 links: rank 4 of 232 → 9.7 px |
| 1937–1947 | World War II, 217,991 links | Dekemvriana, 882 links: rank 90 of 1,209 → 8.6 px |

Delhi and World War II are the same size, though one has 12× the links, because each is the top of its own span. Marathon and the Dekemvriana have about the same links and about the same size, because each sits near the top 10% of its window. The cube keeps only the real headliners big: the median event of any window is 3.9 px.

```ts
// src/components/globe/placement.ts
import type { EventsData } from '../../types.ts'

// The screen, as placement needs to see it. locate() returns null for anything not visible.
export type Viewport = { width: number; height: number; zoom: number; locate(lon: number, lat: number): { x: number; y: number } | null }
export type Placement = { index: number; radius: number; labeled: boolean }
type Box = [x0: number, y0: number, x1: number, y1: number]

const MAX_LABELS = 30
const CELL = 64

export function placeEvents(events: EventsData, viewport: Viewport, ranked: number[], pinned: number | null, target: number, previous: Set<number>): Placement[] {
  // 1. Pool: only the top part of the window competes. 30% at zoom 1.8, doubling per zoom level,
  //    and never fewer than 3x the target, so sparse eras still fill the screen.
  const population = ranked.length
  const pool = Math.min(population, Math.max(Math.ceil(population * Math.min(1, 0.3 * 2 ** (viewport.zoom - 1.8))), target * 3))

  // 2. Order: the open event first, then events already on screen, then newcomers, each group in rank order.
  const candidates: { i: number; x: number; y: number; percentile: number; order: number }[] = []
  const consider = (i: number, rank: number) => {
    const at = viewport.locate(events.lon[i], events.lat[i])
    if (at) candidates.push({ i, ...at, percentile: 1 - rank / population, order: i === pinned ? -1 : previous.has(i) ? rank : rank + population })
  }
  for (let rank = 0; rank < pool; rank++) consider(ranked[rank], rank)
  if (pinned !== null && !candidates.some(c => c.i === pinned)) consider(pinned, 0)
  candidates.sort((a, b) => a.order - b.order)

  // 3. Greedy fit: keep a bubble only if its box overlaps nothing kept before it. Boxes go into a grid of
  //    64px cells, so each test only looks at its neighbours instead of every box on screen.
  const grid = new Map<number, Box[]>()
  const cellsOf = ([x0, y0, x1, y1]: Box) => {
    const keys: number[] = []
    for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++)
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) keys.push(cy * 10_000 + cx)
    return keys
  }
  const free = (box: Box) => cellsOf(box).every(key => (grid.get(key) ?? []).every(b => box[0] >= b[2] || box[2] <= b[0] || box[1] >= b[3] || box[3] <= b[1]))
  const take = (box: Box) => cellsOf(box).forEach(key => grid.set(key, [...(grid.get(key) ?? []), box]))

  const placed: Placement[] = []
  let labels = 0
  for (const { i, x, y, percentile } of candidates) {
    if (placed.length >= target) break
    // Cubed, so only the window's real headliners get big bubbles.
    const radius = 3 + 7 * percentile ** 3
    const bubble: Box = [x - radius - 2, y - radius - 2, x + radius + 2, y + radius + 2]
    if (!free(bubble)) continue
    take(bubble)
    const label: Box = [x + radius + 4, y - 14, x + radius + 12 + Math.min(events.label[i].length, 32) * 6.5, y + 14]
    const labeled = (labels < MAX_LABELS || i === pinned) && free(label)
    if (labeled) {
      take(label)
      labels++
    }
    placed.push({ index: i, radius, labeled })
  }
  return placed
}
```

### 7.3 The map

`createMap` builds the map and wires it to the store:

- **The back of the globe.** `project()` also returns positions for points behind the globe. `locate` keeps a point only if the cosine of its angle from the view centre (the dot product in the long line) is above 0.3, which is under ~72°. London seen from over Tokyo is 86° away, so it's hidden. We don't use 0 because bubbles near the rim get squashed.
- **A throttle.** `place()` runs at most every 100 ms. In between, MapLibre moves the placed bubbles with the globe on every frame, so motion stays smooth.
- **Eras swap paint.** `setPaintProperty` recolours what's already on the GPU, while `setStyle` would reload everything and flash.
- **Borders** come straight from [historical-basemaps](https://github.com/aourednik/historical-basemaps): the snapshot at or before the playhead, fetched and parsed by MapLibre's worker via `setData(url)`.
- **The camera isn't state.** It follows `selected`: fly to a newly opened event unless it's already on screen, and glide while playing. A click is just `update({ selected })`.
- **The worker URL.** Once Vite bundles MapLibre, it can't find its own worker file. `?worker&url` makes Vite bundle it and hand us the URL.

```ts
// src/components/globe/map.ts
import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { events, useHistory } from '../../hooks/useHistory.ts'
import { CATEGORIES } from '../../lib/categories.ts'
import { epochAt, type EpochConfig } from '../../lib/epochs.ts'
import { rank } from '../../lib/rank.ts'
import { formatYear, windowOf } from '../../lib/time.ts'
import { placeEvents, type Viewport } from './placement.ts'

maplibregl.setWorkerUrl(workerUrl)

const LAND = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson'
const BORDERS = 'https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson'
const SNAPSHOTS = [-3000, -2000, -1500, -1000, -700, -500, -400, -323, -300, -200, -100, -1, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1279, 1300, 1400, 1492, 1500, 1530, 1600, 1650, 1700, 1715, 1783, 1800, 1815, 1880, 1900, 1914, 1920, 1930, 1938, 1945, 1960, 1994, 2000, 2010]
const empty = { type: 'FeatureCollection' as const, features: [] }

function styleFor(epoch: EpochConfig): maplibregl.StyleSpecification {
  return {
    version: 8,
    projection: { type: 'globe' },
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      land: { type: 'geojson', data: LAND },
      borders: { type: 'geojson', data: empty },
      events: { type: 'geojson', data: empty },
    },
    layers: [
      { id: 'sea', type: 'background', paint: { 'background-color': epoch.sea } },
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': epoch.land } },
      { id: 'borders', type: 'line', source: 'borders', paint: { 'line-color': epoch.border, 'line-width': 0.7, 'line-opacity': 0.8 } },
      {
        id: 'bubbles', type: 'circle', source: 'events',
        paint: {
          'circle-radius': ['get', 'radius'],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': epoch.ink,
          'circle-stroke-width': ['case', ['get', 'selected'], 2.5, 0.6],
        },
      },
      {
        id: 'labels', type: 'symbol', source: 'events', filter: ['get', 'labeled'],
        layout: {
          'text-field': ['format', ['get', 'name'], {}, '\n', {}, ['get', 'when'], { 'font-scale': 0.8 }],
          'text-font': ['Open Sans Semibold'],
          'text-size': 12,
          'text-anchor': 'left',
          'text-justify': 'left',
          'text-offset': ['get', 'offset'],
          // One line per name: placement reserved a single-line box for it.
          'text-max-width': 40,
          // Placement already decided what fits, so MapLibre must not second-guess it.
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': epoch.ink, 'text-halo-color': epoch.land, 'text-halo-width': 1.2 },
      },
    ],
  }
}

// Not a component, so it reads and writes the store directly instead of through the hook.
export function createMap(container: HTMLElement) {
  const { update } = useHistory.getState()
  let epoch = epochAt(useHistory.getState().time.year)
  let snapshot: number | null = null
  let previous = new Set<number>()
  let timer = 0
  const map = new maplibregl.Map({ container, style: styleFor(epoch), center: [20, 30], zoom: 1.6 })

  function viewport(): Viewport {
    const { clientWidth: width, clientHeight: height } = container
    const centre = map.getCenter()
    const rad = Math.PI / 180
    return {
      width,
      height,
      zoom: map.getZoom(),
      locate(lon, lat) {
        // project() also returns points on the far side of the globe. Keep the near face only: within ~72° of the centre.
        const cos = Math.sin(lat * rad) * Math.sin(centre.lat * rad) + Math.cos(lat * rad) * Math.cos(centre.lat * rad) * Math.cos((lon - centre.lng) * rad)
        if (cos < 0.3) return null
        const p = map.project([lon, lat])
        return p.x < 0 || p.y < 0 || p.x > width || p.y > height ? null : { x: p.x, y: p.y }
      },
    }
  }

  function place() {
    timer = 0
    const { time, selected, view } = useHistory.getState()

    // The era's look: swap paint in place instead of reloading the style.
    const next = epochAt(time.year)
    if (next !== epoch) {
      epoch = next
      map.setPaintProperty('sea', 'background-color', epoch.sea)
      map.setPaintProperty('land', 'fill-color', epoch.land)
      map.setPaintProperty('borders', 'line-color', epoch.border)
      map.setPaintProperty('bubbles', 'circle-stroke-color', epoch.ink)
      map.setPaintProperty('labels', 'text-color', epoch.ink)
      map.setPaintProperty('labels', 'text-halo-color', epoch.land)
    }

    // The border snapshot at or before the playhead. MapLibre's worker downloads and parses it.
    const at = SNAPSHOTS.findLast(y => y <= time.year) ?? SNAPSHOTS[0]
    if (at !== snapshot) {
      snapshot = at
      ;(map.getSource('borders') as maplibregl.GeoJSONSource).setData(`${BORDERS}/world_${at < 0 ? `bc${-at}` : at}.geojson`)
    }

    const ranked = rank(events, windowOf(time))
    const placed = placeEvents(events, viewport(), ranked, selected, view.detail, previous)
    previous = new Set(placed.map(p => p.index))

    ;(map.getSource('events') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: placed.map(p => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [events.lon[p.index], events.lat[p.index]] },
        properties: {
          index: p.index,
          radius: p.radius,
          color: CATEGORIES[events.category[p.index]].color,
          selected: p.index === selected,
          labeled: p.labeled,
          name: events.label[p.index],
          when: events.end[p.index] > events.start[p.index] ? `${formatYear(events.start[p.index])} – ${formatYear(events.end[p.index])}` : formatYear(events.start[p.index]),
          // text-offset is in ems (12px): the bubble radius plus a 5px gap.
          offset: [(p.radius + 5) / 12, 0],
        },
      })),
    })
    const minInlinks = Math.min(...placed.map(p => events.inlinks[p.index]))
    update({ drawn: { shown: placed.length, population: ranked.length, minInlinks: placed.length ? minInlinks : 0 } })
  }

  // Placement runs at most every 100 ms while things move. MapLibre keeps moving the bubbles every frame in between.
  const schedule = () => {
    if (!timer) timer = window.setTimeout(place, 100)
  }

  // The camera isn't state: it follows `selected`. Fly to a newly opened event unless it's already on screen; glide while playing.
  const lngLat = (i: number): [number, number] => [events.lon[i], events.lat[i]]
  function reveal(i: number) {
    if (!viewport().locate(...lngLat(i))) map.flyTo({ center: lngLat(i), zoom: Math.max(map.getZoom(), 3), duration: 1600 })
  }
  function glide(i: number) {
    map.easeTo({ center: lngLat(i), zoom: Math.max(map.getZoom(), 2.5), duration: 2400 })
  }

  map.on('load', place)
  map.on('move', schedule)
  map.on('click', e => {
    const hit = map.queryRenderedFeatures(e.point, { layers: ['bubbles'] })[0]
    update({ selected: hit ? Number(hit.properties.index) : null })
  })
  const unsubscribe = useHistory.subscribe((s, prev) => {
    if (s.time !== prev.time || s.selected !== prev.selected || s.view !== prev.view) schedule()
    if (s.selected !== null && s.selected !== prev.selected) (s.play.on ? glide : reveal)(s.selected)
  })

  return () => {
    unsubscribe()
    clearTimeout(timer)
    map.remove()
  }
}
```

`Globe` mounts it. `createMap` returns its cleanup, which is exactly what `useEffect` wants.

The wrapper div is a real trap. MapLibre's CSS sets `position: relative` on the map element, which beats Tailwind's `absolute`. The map then has zero height, and placement reports "0 events".

```tsx
// src/components/globe/Globe.tsx
import { useEffect, useRef } from 'react'
import { createMap } from './map.ts'

// React owns the element, createMap owns everything inside it, and its cleanup is what useEffect returns.
export function Globe() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => createMap(ref.current!), [])
  // MapLibre's CSS sets position: relative on the map element, so the positioning lives on a wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={ref} className="h-full" />
    </div>
  )
}
```

**Checkpoint.** Replace `src/main.tsx` for a moment with the globe alone. We'll put the real one back in §9.

```tsx
// src/main.tsx
import { createRoot } from 'react-dom/client'
import './index.css'
import { Globe } from './components/globe/Globe.tsx'

createRoot(document.getElementById('root')!).render(<Globe />)
```

Run `npm run dev`. You should get a cream globe (the Age of Sail palette) on a white page, with the borders of 1715 (the last snapshot before the playhead, 1750) and a few dozen named bubbles: the French Revolution, Saint Petersburg, the Battle of Plassey…

---

## 8. The timeline

One canvas, redrawn at most once per frame, with two bands:

```
 y=6  ─┬─ overview: 800 density bars on the log scale, the lens (the window), the playhead
 y=32 ─┘  press or drag here to move the playhead; the wheel changes the span
 y=45     year labels
 y=50 ─ ─ ─ ─ below this line, presses hit the chronicle
 y=68      │1765 American Revolution                          row 1
 y=82   │1701 War of the Spanish Succession  │1775 American Revolutionary War     row 0
 y=88 ─●───────────────────────────●──────────●────  axis
```

- **The overview.** Each bar is the number of events starting in that slice of time, log-scaled with `Math.log1p` so antiquity isn't flat. The lens is the window. Press anywhere to jump there: there are no handles to aim for.
- **The chronicle** is the window stretched to full width in plain years, with the best events named in order, laid out the same greedy way as the map. Each label takes the first of two rows where it fits. A row-1 label's stem crosses row 0, so it also reserves a 4 px slot there.
- **Two browser details:** the canvas is sized in device pixels (`devicePixelRatio`) or it's blurry on retina screens. All listeners share one `AbortController`, so the cleanup removes them all, which matters because React's StrictMode mounts twice in development.

```ts
// src/components/timeline/canvas.ts
import { events, useHistory } from '../../hooks/useHistory.ts'
import { CATEGORIES } from '../../lib/categories.ts'
import { rank } from '../../lib/rank.ts'
import { formatYear, tToYear, windowOf, yearToT } from '../../lib/time.ts'

const PAD = 12
const BAR_TOP = 6
const BAR_BOTTOM = 32
// A press above this line scrubs the overview, below it hits the chronicle.
const OVERVIEW_BOTTOM = 50
const AXIS = 88
const ROW_GAP = 14
const BINS = 800
const TICKS = [-2000, -1000, -500, 1, 500, 1000, 1500, 1800, 1900, 2000]
const LENS = '#f0a070'

type Label = { i: number; x: number; x1: number; row: number; text: string }

// Not a component, so it reads and writes the store directly instead of through the hook.
export function createTimeline(canvas: HTMLCanvasElement) {
  const { update } = useHistory.getState()
  const ctx = canvas.getContext('2d')!
  let width = 0
  let height = 0
  let dragging = false
  let frame = 0
  let labels: Label[] = []

  // How many events start in each slice of the (log) bar, counted once.
  const bins = new Uint32Array(BINS)
  for (let i = 0; i < events.count; i++) bins[Math.min(BINS - 1, Math.floor(yearToT(events.start[i]) * BINS))]++
  const maxLog = Math.log1p(Math.max(...bins))

  const xAt = (t: number) => PAD + t * (width - 2 * PAD)
  const tAt = (x: number) => Math.min(1, Math.max(0, (x - PAD) / (width - 2 * PAD)))

  // The window stretched to full width in plain years, with the best events labelled. Greedy, like the map:
  // in rank order, each label takes the first of two rows where it fits, and its stem must cross the lower row freely.
  function layoutChronicle() {
    const [start, end] = windowOf(useHistory.getState().time)
    const rows: [number, number][][] = [[], []]
    const free = (row: number, a: number, b: number) => rows[row].every(([x0, x1]) => b <= x0 || a >= x1)
    labels = []
    ctx.font = '11px system-ui'
    for (const i of rank(events, [start, end]).slice(0, 300)) {
      const x = PAD + ((Math.max(events.start[i], start) - start) / (end - start)) * (width - 2 * PAD)
      const text = `${formatYear(events.start[i])}  ${events.label[i]}`
      const x1 = x + 4 + ctx.measureText(text).width
      if (x1 > width - 4) continue
      const row = [0, 1].find(r => free(r, x - 3, x1 + 8) && (r === 0 || free(0, x - 2, x + 2)))
      if (row === undefined) continue
      rows[row].push([x - 3, x1 + 8])
      if (row === 1) rows[0].push([x - 2, x + 2])
      labels.push({ i, x, x1, row, text })
    }
  }

  function draw() {
    frame = 0
    const { time, selected } = useHistory.getState()
    const [start, end] = windowOf(time)
    const x0 = xAt(yearToT(start))
    const x1 = xAt(yearToT(end))
    ctx.clearRect(0, 0, width, height)

    // Overview: event density per slice, bright inside the lens.
    for (let b = 0; b < BINS; b++) {
      if (!bins[b]) continue
      const x = xAt(b / BINS)
      const h = ((BAR_BOTTOM - BAR_TOP) * Math.log1p(bins[b])) / maxLog
      ctx.fillStyle = x >= x0 && x <= x1 ? LENS : 'rgba(255,255,255,0.25)'
      ctx.fillRect(x, BAR_BOTTOM - h, 1, h)
    }
    ctx.fillStyle = 'rgba(240,160,112,0.15)'
    ctx.fillRect(x0, BAR_TOP, Math.max(1, x1 - x0), BAR_BOTTOM - BAR_TOP)
    ctx.fillStyle = LENS
    ctx.fillRect(xAt(yearToT(time.year)) - 1, BAR_TOP - 3, 2, BAR_BOTTOM - BAR_TOP + 6)
    ctx.font = '10px system-ui'
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    for (const y of TICKS) ctx.fillText(formatYear(y), xAt(yearToT(y)), BAR_BOTTOM + 13)

    // Chronicle: an axis, and per label a dot in its category colour with a stem up to its row.
    layoutChronicle()
    ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.fillRect(PAD, AXIS, width - 2 * PAD, 1)
    for (const { i, x, row, text } of labels) {
      const baseline = AXIS - 6 - row * ROW_GAP
      ctx.fillStyle = 'rgba(255,255,255,0.3)'
      ctx.fillRect(x, baseline - 9, 1, AXIS - baseline + 9)
      ctx.fillStyle = CATEGORIES[events.category[i]].color
      ctx.beginPath()
      ctx.arc(x, AXIS, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = i === selected ? LENS : 'rgba(255,255,255,0.85)'
      ctx.fillText(text, x + 4, baseline)
    }
  }

  // Many store updates can land in one frame; draw once per frame.
  const redraw = () => {
    if (!frame) frame = requestAnimationFrame(draw)
  }

  // One AbortController removes every listener at cleanup. StrictMode mounts twice in dev, so this matters.
  const listeners = new AbortController()
  const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void) =>
    canvas.addEventListener(type, fn, { signal: listeners.signal, passive: false })
  on('pointerdown', e => {
    if (e.offsetY < OVERVIEW_BOTTOM) {
      dragging = true
      canvas.setPointerCapture(e.pointerId)
      update({ time: { year: tToYear(tAt(e.offsetX)) } })
      return
    }
    const hit = labels.find(l => e.offsetX >= l.x - 3 && e.offsetX <= l.x1 && Math.abs(e.offsetY - (AXIS - 10 - l.row * ROW_GAP)) < 8)
    if (hit) update({ selected: hit.i })
  })
  on('pointermove', e => dragging && update({ time: { year: tToYear(tAt(e.offsetX)) } }))
  on('pointerup', () => (dragging = false))
  on('wheel', e => {
    e.preventDefault()
    update({ time: { span: useHistory.getState().time.span * Math.exp(e.deltaY * 0.0015) } })
  })

  // Canvas pixels must match device pixels, or everything is blurry on a retina screen.
  const resize = new ResizeObserver(([entry]) => {
    width = entry.contentRect.width
    height = entry.contentRect.height
    canvas.width = width * devicePixelRatio
    canvas.height = height * devicePixelRatio
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
    draw()
  })
  resize.observe(canvas)
  const unsubscribe = useHistory.subscribe((s, prev) => {
    if (s.time !== prev.time || s.selected !== prev.selected) redraw()
  })

  return () => {
    listeners.abort()
    resize.disconnect()
    unsubscribe()
    cancelAnimationFrame(frame)
  }
}
```

The bar around it holds Play, the explore switch (◎) and the speed stepper, all plain `update()` calls:

```tsx
// src/components/timeline/Timeline.tsx
import { useEffect, useRef } from 'react'
import { PLAY_SPEEDS } from '../../consts.ts'
import { useHistory } from '../../hooks/useHistory.ts'
import { createTimeline } from './canvas.ts'

export function Timeline() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const { on, speed, explore } = useHistory(s => s.play)
  const update = useHistory(s => s.update)
  const step = PLAY_SPEEDS.indexOf(speed)
  useEffect(() => createTimeline(canvas.current!), [])
  return (
    <div className="absolute inset-x-5 bottom-5 flex h-28 items-center gap-3 rounded-2xl bg-black/55 px-3 backdrop-blur-md">
      <div className="flex w-24 shrink-0 flex-col items-center gap-2 text-xs">
        <div className="flex gap-1">
          <button onClick={() => update({ play: { on: !on } })} className="size-9 rounded-full ring-1 ring-white/30">
            {on ? '❚❚' : '▶'}
          </button>
          <button onClick={() => update({ play: { explore: !explore } })} title="Auto-explore" className={`size-9 rounded-full ring-1 ${explore ? 'text-orange-300 ring-orange-300/60' : 'opacity-50 ring-white/20'}`}>
            ◎
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button disabled={step === 0} onClick={() => update({ play: { speed: PLAY_SPEEDS[step - 1] } })} className="px-1 disabled:opacity-25">
            −
          </button>
          <span className="w-12 text-center">{speed} yr/s</span>
          <button disabled={step === PLAY_SPEEDS.length - 1} onClick={() => update({ play: { speed: PLAY_SPEEDS[step + 1] } })} className="px-1 disabled:opacity-25">
            +
          </button>
        </div>
      </div>
      <canvas ref={canvas} className="h-24 min-w-0 flex-1 touch-none" />
    </div>
  )
}
```

---

## 9. The React UI

The components read slices and call `update`. Nothing else.

```tsx
// src/components/Header.tsx
import { SPANS } from '../consts.ts'
import { useHistory } from '../hooks/useHistory.ts'
import { epochAt } from '../lib/epochs.ts'
import { formatYear, windowOf } from '../lib/time.ts'

export function Header() {
  const time = useHistory(s => s.time)
  const detail = useHistory(s => s.view.detail)
  const drawn = useHistory(s => s.drawn)
  const update = useHistory(s => s.update)
  const [start, end] = windowOf(time)
  return (
    <header className="pointer-events-none absolute top-5 left-6 drop-shadow">
      <div className="text-[11px] tracking-[0.3em] text-orange-300 uppercase">{epochAt(time.year).name}</div>
      <h1 className="font-serif text-5xl">{formatYear(start)} – {formatYear(end)}</h1>
      <div className="pointer-events-auto mt-3 flex items-center gap-1 text-xs">
        <span className="mr-2 opacity-60">Span</span>
        {SPANS.map(span => (
          <button key={span} onClick={() => update({ time: { span } })} className={`rounded-full px-2 py-0.5 ${Math.round(time.span) === span ? 'bg-orange-300 text-black' : 'hover:bg-white/10'}`}>
            {span}
          </button>
        ))}
        <span className="ml-1 opacity-60">years</span>
      </div>
      <label className="pointer-events-auto mt-2 flex items-center gap-2 text-xs">
        <span className="opacity-60">Detail</span>
        <input type="range" min={25} max={600} value={detail} onChange={e => update({ view: { detail: Number(e.target.value) } })} />
        <span className="opacity-70">≥ {drawn.minInlinks.toLocaleString()} links</span>
      </label>
      <div className="mt-1 text-xs opacity-50">{drawn.shown} of {drawn.population.toLocaleString()} events in this span</div>
    </header>
  )
}
```

### Surprise me

The time machine is the smallest feature in the app, and it shows the design best. It needs no new state and no new rule:

1. Rows are sorted by score, so "a notable event" is just a random row index below 3,000.
2. A `Set` remembers what was shown this session, so it doesn't repeat until the pool runs out.
3. It calls `update({ selected: i })`, and that's all. `apply()` sees the event is outside the window and moves time to it, keeping the span. The globe sees a new `selected` off screen and flies there, the panel opens, and the timeline and chronicle redraw.

The R key does the same, but ignores key auto-repeat, or holding R would fire a trip 30 times a second.

```tsx
// src/components/Surprise.tsx
import { useEffect } from 'react'
import { SURPRISE_POOL } from '../consts.ts'
import { events, useHistory } from '../hooks/useHistory.ts'

// Events already shown this session, so the time machine doesn't repeat itself until the pool runs out.
const seen = new Set<number>()

function pickUnseen() {
  const pool = Math.min(SURPRISE_POOL, events.count)
  if (seen.size >= pool) seen.clear()
  let i = Math.floor(Math.random() * pool)
  while (seen.has(i)) i = Math.floor(Math.random() * pool)
  seen.add(i)
  return i
}

export function Surprise() {
  const update = useHistory(s => s.update)
  // R from anywhere, once per press: holding the key would otherwise fire a trip per auto-repeat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'r' && !e.repeat && !(e.target instanceof HTMLInputElement) && update({ selected: pickUnseen() })
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [update])
  return (
    <button type="button" onClick={() => update({ selected: pickUnseen() })} className="absolute top-5 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-4 py-2 text-sm backdrop-blur-md hover:bg-black/70">
      ⚄ Surprise me
    </button>
  )
}
```

The panel fetches the article's summary and thumbnail from Wikipedia's REST API. `key={selected}` gives each event a fresh card, and the Esc listener lives in the card, so it exists only while one is open:

```tsx
// src/components/EventPanel.tsx
import { useEffect, useState } from 'react'
import { events, useHistory } from '../hooks/useHistory.ts'
import { CATEGORIES } from '../lib/categories.ts'
import { formatYear } from '../lib/time.ts'

type Summary = { extract: string; thumbnail?: { source: string } }

export function EventPanel() {
  const selected = useHistory(s => s.selected)
  // Keyed by event, so switching events starts from an empty card instead of flashing the previous summary.
  return selected === null ? null : <Card key={selected} i={selected} />
}

function Card({ i }: { i: number }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const update = useHistory(s => s.update)
  useEffect(() => {
    const abort = new AbortController()
    fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(events.article[i])}`, { signal: abort.signal })
      .then(r => r.json())
      .then(setSummary)
      .catch(() => {})
    return () => abort.abort()
  }, [i])
  // Esc closes the card. The listener exists only while a card is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && update({ selected: null })
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [update])
  const category = CATEGORIES[events.category[i]]
  return (
    <aside className="absolute top-5 right-5 bottom-40 w-96 overflow-y-auto rounded-2xl bg-[#f6efdc] text-[#2d2a26] shadow-2xl">
      {summary?.thumbnail && <img src={summary.thumbnail.source} alt="" className="h-44 w-full object-cover" />}
      <div className="p-5">
        <div className="flex justify-between text-[11px] tracking-widest uppercase opacity-60">
          <span>
            <span style={{ color: category.color }}>●</span> {category.name} · {formatYear(events.start[i])}
          </span>
          <button onClick={() => update({ selected: null })}>✕</button>
        </div>
        <h2 className="mt-1 font-serif text-2xl">{events.label[i]}</h2>
        <div className="mt-2 text-sm">
          <b>{events.inlinks[i].toLocaleString()}</b> articles link here
        </div>
        <p className="mt-3 font-serif leading-relaxed">{summary?.extract ?? '…'}</p>
        <a className="mt-3 inline-block text-sm text-[#8b3a2b] underline" href={`https://en.wikipedia.org/wiki/${events.article[i]}`} target="_blank" rel="noreferrer">
          Read on Wikipedia
        </a>
      </div>
    </aside>
  )
}
```

```tsx
// src/components/App.tsx
import { EventPanel } from './EventPanel.tsx'
import { Globe } from './globe/Globe.tsx'
import { Header } from './Header.tsx'
import { Surprise } from './Surprise.tsx'
import { Timeline } from './timeline/Timeline.tsx'

export function App() {
  return (
    <div className="relative h-full overflow-hidden bg-[#0b0f14] text-white">
      <Globe />
      <Header />
      <Surprise />
      <EventPanel />
      <Timeline />
    </div>
  )
}
```

Put the real `src/main.tsx` back:

```tsx
// src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './components/App.tsx'

// Importing App imports the store, which loads the data (a top-level await), so nothing renders before it's there.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

---

## 10. Run it

```bash
npm run data     # once, ~10 minutes (skip it if you ran §2–§4)
npm run dev      # http://localhost:5173
```

You should see "1700 – 1800", a cream Age of Sail globe with the borders of 1715, and the chronicle: 1701 War of the Spanish Succession, 1740 War of the Austrian Succession, 1775 American Revolutionary War…

- **Drag the top band of the timeline:** the world recolours at 500, 1500 and 1900, the borders change, and the chronicle rolls through history.
- **Click span 1** and scrub the 1940s, one year at a time.
- **Zoom into Europe:** smaller events appear, and the big ones stay put.
- **Click a bubble**, then drag time far away: the card closes by itself.
- **Press ▶:** 10 years a second, each new top event opens and the camera glides to it. Switch ◎ off and only time moves.
- **Press Surprise me (or R):** time jumps to a random notable event and the globe flies there.

| You see | Cause |
|---|---|
| A black screen, "0 events" | the map has no height: the wrapper div in `Globe.tsx` |
| The globe, but no borders | GitHub's raw file server is blocked on your network |
| `No public/data/events.arrow` | the export hasn't run: `npm run data` |
| `QLever 429` | QLever is busy: wait a minute and run it again |

---

## 11. From the mini to the full app

Every file here has a bigger sibling in this repo:

| The full app adds… | Where |
|---|---|
| 10 categories and a category filter (`view.hidden`) | `src/lib/categories.ts`, `src/components/CategoryMenu.tsx` |
| The story thread: a reaction that hops along "what happened next" | `src/lib/story.ts`, `src/hooks/useHistory.ts` |
| Shareable URLs (`#1942,500y,Q362`), the tour, search | `src/hooks/useHistory.ts`, `src/components/*` |
| The panel's text with working links: a link to one of our events opens it in the app | `src/components/EventPanel.tsx` |
| First-listed locations from Wikidata's entity API | `scripts/fetch-events.ts` |
| Simplified borders with their own labels and colours | `scripts/fetch-geo.ts`, `src/components/globe/borders.ts` |
| Each era as a different kind of map: papyrus, portolan, engraving, satellite | `src/lib/epochs.ts`, `src/components/globe/style.ts`, `textures.ts` |
| Less blinking: slack for events on screen, sticky label sides and sizes | `src/components/globe/placement.ts` |
| A flat map mode, era tabs, a hover preview on the timeline, hover rings, the landing ripple | `src/components/globe/*`, `src/components/timeline/canvas.ts` |

Each one is a variation on something you've built: a fact in the pipeline, a pure function in `lib/`, a field and a rule in the store, or a layer in the map.

The data path grows around the same Feather file:

- **Wikipedia leads.** `scripts/fetch-leads.ts` fetches each article's lead section with `action=parse`, the only API that keeps the links, and cleans it down to paragraphs, bold, italics and `/wiki/` links. The export writes them to a second Feather file, `leads.arrow`, in the same row order. See [The shipped files](README.md#the-shipped-files).
- **D1 and a Worker.** The app never downloads all the leads. `scripts/seed-db.ts` loads them into a Cloudflare D1 database, and `worker/index.ts` serves one per opened event at `/api/leads/:qid`. See [Deploy](README.md#deploy).
- **ZSTD.** Both files are compressed: `events.arrow` drops from 5 MB to 1.7 MB, and the app unzips each column once before viewing it. See [docs/zero-copy.md](docs/zero-copy.md#compression-breaks-it).
- **A public dataset.** The very `events.arrow` the app serves, and `leads.arrow`, are on Hugging Face as [Francesco/mappa-mundi](https://huggingface.co/datasets/Francesco/mappa-mundi), so `pd.read_feather` opens them. See [Dataset](README.md#dataset).

Thank you for reading!
