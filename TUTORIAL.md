# Build a History Atlas from Wikipedia, from Zero

Hello There!! Today we'll build, from an empty folder, an interactive atlas of five thousand years of history. It has a 3D globe, a timeline you drag through, and about 23,000 events from Wikipedia. Each event is ranked by how many other Wikipedia articles link to it.

This is the **mini version of WikiHistory**, the app in this repo. It has the same structure and the same ideas, with fewer options. At the end you'll have:

- **a data pipeline** that downloads events from Wikidata, measures how important each one is on Wikipedia, and saves everything in two small files: 0.6 MB of numbers and a JSON file of names;
- **a globe** that shows the most important events of the moment, shows more when you zoom in, and never turns into a mess of dots on top of each other;
- **a timeline** with a log scale, a lens that marks the years you're looking at, and a *chronicle* that names the best event of each few years;
- **four eras** with their own map colours, and the historical borders of the year you're looking at;
- **Play**: time moves at N years per second while the camera follows the most important event.

**What you need to know:** basic JavaScript or TypeScript, and how to use a terminal and npm. That's all. Everything else is explained when we meet it: Wikidata, SPARQL, SQL, binary files, MapLibre, canvas, zustand, React and Tailwind.

**How to read this:**

- We build **bottom up**: data first, then logic, then state, then what you see on screen. We test each layer before we use it.
- A code block that starts with a file path (like `// src/model/time.ts`) is a **complete file**. Create the file, copy it in, and it works.
- Every output shown is **real**. It's from the run I did while writing this.
- There are **checkpoints** where you run something and see a result. Don't skip them.

Let's get started!

**Contents**

0. [The plan](#0-the-plan)
1. [Setup](#1-setup)
2. [What is an event? Wikidata](#2-what-is-an-event-wikidata)
3. [How important is it? In-degree](#3-how-important-is-it-in-degree)
4. [Decisions: score, position, one binary file](#4-decisions-score-position-one-binary-file)
5. [Time: a log scale and "the moment"](#5-time-a-log-scale-and-the-moment)
6. [What matters in a moment: ranking](#6-what-matters-in-a-moment-ranking)
7. [State: one store and one owner of change](#7-state-one-store-and-one-owner-of-change)
8. [The globe: MapLibre and level of detail](#8-the-globe-maplibre-and-level-of-detail)
9. [The timeline: a canvas scrubber and the chronicle](#9-the-timeline-a-canvas-scrubber-and-the-chronicle)
10. [The React UI and startup](#10-the-react-ui-and-startup)
11. [Run it](#11-run-it)
12. [From the mini to the full app](#12-from-the-mini-to-the-full-app)

---

## 0. The plan

The project has two halves. They only meet at two files:

```
 OFFLINE: Node, you run it once                          BROWSER: every visit

 Wikidata ──► fetch-events.ts ────┐
                                  ├──► data/history.sqlite
 Wikipedia ─► fetch-wikipedia.ts ─┘          │
                                     export-events.ts
                                             │
                                             ▼
                           public/data/events.bin          ──►  model/     pure rules: time, ranking
                           public/data/events-meta.json         state/     one store + navigation
                                                                map/       globe + what fits on screen
                                                                timeline/  the bar at the bottom
                                                                ui/        React: header, panel, buttons
```

Two rules keep the project simple. We'll come back to both many times.

1. **The fetch scripts only write down facts. The export script makes every decision.** A fact is "this battle has these coordinates" or "this article has 1,838 incoming links". A decision is "which coordinate do we use?", "how important is it?" or "do we keep it?". Downloading takes minutes, while the export takes seconds. So when you change a rule, you only re-run the export. (One exception, to keep the database simple: `fetch-events` already picks each event's year, and skips years outside 3000 BC–2026. If you change those two rules, re-run `fetch-events` too.)
2. **In the app, imports only point down:** `ui → map, timeline → state → model`. The `model` folder knows nothing about the browser, React or MapLibre. So it runs in Node too, and we'll test it in the terminal before we draw anything.

## 1. Setup

### 1.1 The tools, and why

| Tool | Why we use it |
|---|---|
| **Node 24** | It has SQLite built in (`node:sqlite`), and it runs `.ts` files directly. So the pipeline needs no extra packages and no build step. |
| **Vite** | Runs the app in development and bundles it for production. |
| **MapLibre GL** | Draws maps with the graphics card (WebGL). It can draw a real globe, and it's free, with no API key. |
| **React** | Only for the header, the panel and the buttons. The map and the timeline are plain code that draws by itself, and React only gives it a DOM element. §7 explains why that matters for speed. |
| **zustand** | A small "store": one object that holds the app's state. Plain code and React components can both read it and listen to it. |
| **Tailwind** | Styling with short class names instead of CSS files. |

First check your Node version:

```bash
node -v      # must print v24 or newer
```

The commands in this tutorial are for macOS and Linux. On Windows, use WSL or Git Bash.

Then create the project and the folders:

```bash
mkdir mini-atlas && cd mini-atlas
npm init -y && npm pkg set type=module
npm install maplibre-gl react react-dom zustand
npm install -D vite @vitejs/plugin-react typescript@~6.0 @types/react @types/react-dom @types/node@24 tailwindcss @tailwindcss/vite
mkdir -p scripts src/model src/state src/map src/timeline src/ui
```

This is where every file will go. `data/` and `public/data/` are created by the scripts.

```
mini-atlas/
├─ package.json  tsconfig.json  vite.config.ts  index.html
├─ scripts/                  run with Node, never in the browser
│  ├─ fetch-events.ts        Wikidata  → data/history.sqlite
│  ├─ fetch-wikipedia.ts     Wikipedia → data/history.sqlite
│  ├─ export-events.ts       data/history.sqlite → public/data/
│  ├─ explore.ts             checkpoint: ask the ranking questions in the terminal
│  └─ check-state.ts         checkpoint: try the store and navigation in the terminal
├─ data/history.sqlite
├─ public/data/              events.bin + events-meta.json
└─ src/
   ├─ main.tsx  index.css
   ├─ model/      categories.ts  time.ts  events.ts  epochs.ts  rank.ts
   ├─ state/      store.ts  navigation.ts
   ├─ map/        placement.ts  atlas.ts
   ├─ timeline/   timeline.ts
   └─ ui/         App.tsx  Header.tsx  EventPanel.tsx  TimelineBar.tsx
```

Now replace the whole `package.json` with this one. It's the same as npm created, plus the `scripts` part (your version numbers may be a little newer):

**`package.json`**
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

### 1.2 TypeScript config

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

Most lines are standard. Three matter for this project:

- **`allowImportingTsExtensions`.** Node needs the full file name in an import, like `'./time.ts'`. Vite doesn't care. With this flag TypeScript accepts the `.ts` ending, so **we always write it**. Then any file that doesn't touch the browser can run in Node, and the pipeline scripts share the `model/` files with the app.
- **`erasableSyntaxOnly`.** Node runs TypeScript by *deleting* the types, not by compiling them. A few TypeScript features need compiling, like `enum`. This flag forbids them, so Node can always run our files.
- **`verbatimModuleSyntax`.** An import that brings only types must say so: `import type { EventsData } from …`. Type-only imports are deleted before Node runs the file.

### 1.3 Vite, HTML and CSS

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

MapLibre does its heavy work, like reading map files, in a **Web Worker**: a background thread that has no access to the page. Its worker is written as an ES module, so we tell Vite to build workers that way (`worker: { format: 'es' }`).

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

`@import 'tailwindcss'` turns Tailwind on. From now on a class like `absolute inset-0` is a small CSS rule: `position: absolute; top: 0; right: 0; bottom: 0; left: 0`. Some others you'll see:

| Class | Means |
|---|---|
| `h-full` | height: 100% |
| `bg-black/55` | black background at 55% opacity |
| `bg-[#0b0f14]`, `text-[11px]` | a custom value in square brackets |
| `size-9` | width and height of 2.25rem |
| `pointer-events-none` | clicks pass through this element to whatever is below it |

### 1.4 TypeScript syntax you'll meet

| Syntax | Meaning |
|---|---|
| `value!` | "I know this isn't null": `getElementById('root')!` |
| `a ??= b` | set `a` to `b` only if `a` is still `undefined` or `null` |
| `{ ...a, ...(cond ? {} : b) }` | copy `a`, and add the fields of `b` only when `cond` is false |
| `'glide' as const` | the literal type `'glide'`, not just `string` |
| `[lon: number, lat: number]` | a two-number array, with a name for each slot |
| `10_000` | the number 10000; the `_` is only there for reading |
| `A & { … }` | a type with all the fields of `A` plus these |
| `await` at the top of a file | allowed in ES modules: the file waits for the promise before going on |
| `;(x as T).f()` | we write no semicolons, so a line that starts with `(` would join the line above. Starting it with `;` prevents that. |
| `<K extends keyof HTMLElementEventMap>` | `K` is any event name, like `'wheel'`, and `HTMLElementEventMap[K]` is the type of that event |
| `list.flatMap(x => ok ? [y] : [])` | map and filter in one go: returning `[]` drops the item |
| `Array.from({ length: 3 }, (_, i) => i * 50)` | makes `[0, 50, 100]` |
| `parseInt('-0489-09-07')` | `-489`: it reads the number and stops at the first character that can't be part of it |
| `import './index.css'` | Vite adds this CSS file to the page |
| `process.argv.slice(2)` | the words you typed after `node script.ts` |

---

## 2. What is an event? Wikidata

**Wikidata** is the database behind Wikipedia. Everything in it is an *item* with an ID that starts with Q, called a **QID**: the Battle of Hastings is `Q83224`. Facts are *statements* of the form "item – property – value". Properties have IDs that start with P:

| Property | Meaning | For the Battle of Hastings |
|---|---|---|
| `P31` | instance of | battle |
| `P279` | subclass of | (used on classes: *naval battle* is a subclass of *battle*) |
| `P585` | point in time | 1066 |
| `P580` / `P582` | start time / end time | (for wars: 1939 / 1945) |
| `P571` | inception | (for cities: when they were founded) |
| `P625` | coordinate location | 0.4875°E, 50.91°N |
| `P276` | location | Battle, East Sussex |
| `P361` | part of | Norman conquest of England |

There's also the **sitelink count**: how many Wikipedia languages have an article about the item. For Hastings it's 81.

### 2.1 SPARQL in ten lines

We ask Wikidata questions in a query language called **SPARQL**. Here's what you need to read our queries:

- **A pattern is a statement with blanks.** `?e wdt:P585 ?time .` means "find every `?e` and `?time` where `?e` has the point in time `?time`". Words that start with `?` are the blanks. The engine fills them in and returns one row per way it can fill them.
- **`SELECT ?e ?time WHERE { … }`** says which blanks to return, and which patterns must be true.
- **`PREFIX wd: <http://www.wikidata.org/entity/>`** is a shortcut. With it, `wd:Q83224` means `http://www.wikidata.org/entity/Q83224`. A full URL used as a name like that is called an **IRI**. `wd:` is for items and `wdt:` is for properties.
- **`;`** means "same subject, next pattern": `?e wdt:P31 ?type ; wdt:P585 ?time .`
- **`OPTIONAL { … }`** keeps the row even when this pattern has no match. The blank is then just empty.
- **`VALUES ?e { wd:Q83224 wd:Q31900 }`** fixes `?e` to these items.
- **`/`** chains two properties, **`*`** means "zero or more steps" and **`+`** means "one or more steps".
- **`FILTER(LANG(?label) = "en")`** keeps only the rows where the label is in English.

The official Wikidata Query Service times out on big questions (there are almost 13,000 battles). So we use **QLever**, a free SPARQL engine that answers the same questions in seconds. Try it in your terminal:

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

In words: "for the Battle of Hastings and the Battle of Marathon, give me the sitelink count, and the coordinates and point in time if they exist". Here's the real answer, shortened:

```json
{ "results": { "bindings": [
  { "e":         { "type": "uri",     "value": "http://www.wikidata.org/entity/Q31900" },
    "sitelinks": { "type": "literal", "value": "76" },
    "coord":     { "type": "literal", "value": "POINT(23.978333 38.118056)" },
    "time":      { "type": "literal", "value": "-0489-09-07T00:00:00Z" } },
  { "e":         { "type": "uri",     "value": "http://www.wikidata.org/entity/Q83224" },
    "sitelinks": { "type": "literal", "value": "81" },
    "coord":     { "type": "literal", "value": "POINT(0.487500 50.911945)" },
    "time":      { "type": "literal", "value": "1066-10-20T00:00:00Z" } }
] } }
```

Each row is one "binding", and each blank has a `value`. **Every value is a string**, even numbers, so our code will call `Number(…)` on them.

Three traps are hiding in this answer:

1. **Marathon was in 490 BC, but it says `-0489`.** Wikidata's data format (called **RDF**) counts years like astronomers do, with a year 0: 0 is 1 BC, −1 is 2 BC, and so on. Historians have no year 0. So we shift every year ≤ 0 down by one. Without that, all of antiquity is off by a year.
2. **`POINT(lon lat)` has longitude first.** This text format for shapes is called **WKT**. GeoJSON and MapLibre also put longitude first, so we use `[lon, lat]` everywhere.
3. **Hastings was on 14 October, but it says the 20th.** The RDF output converts old dates to the modern Gregorian calendar. We only keep years, so this one doesn't hurt us.

### 2.2 Which events? A list we choose

Wikidata has a general class called *occurrence*. It sounds perfect, but half of it is sports seasons, tennis tournaments and award shows. So we choose the classes that are real history ourselves. We give each one a colour and a weight, which §4 explains:

```ts
// src/model/categories.ts
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

To find the QID of a class, search for it on wikidata.org. The ID is in the page address: wikidata.org/wiki/Q178561 is *battle*.

In the query we write `?e wdt:P31/wdt:P279* wd:Q178561`. In words: "`?e` is an instance of something that is *battle*, or a subclass of battle at any depth". That's how sieges and naval battles come in without being listed.

One item can match several classes. It's kept once, with the **lowest category number**. So a battle that is also a "political event" stays a battle.

### 2.3 Where did it happen?

This is the hardest question in the whole project. An event can have four different answers, and we record all of them:

1. **Its own coordinates** (`P625`). Most battles have them, and they're exact.
2. **The coordinates in its Wikipedia article.** Some battles have them on Wikipedia but not on Wikidata. We download those in §3.
3. **The middle of its sub-events.** Everything that is "part of" the event (`P361`), at any depth (`P361+`).
4. **One of its locations** (`P276`).

Why do we need #3? Because a war has no single place, and its listed locations are whole continents. Our own database shows how bad that gets. The location of World War II came back as the point **15°E 0°N, in the middle of Central Africa**, and World War I got a point in **China**. Useless.

But WWII has **1,124 sub-events with coordinates**: its battles. Their middle is **22.5°E 45.6°N**, in the middle of the European fighting. **A war is where its battles were.**

We use the **median** for the middle, not the average. The median is the middle value after sorting:

```
latitudes of 5 battles:   48  49  50  51  -12      (-12 is a raid on Darwin, in Australia)
average:                  (48 + 49 + 50 + 51 - 12) / 5 = 37.2      ✗ pulled 1,300 km south
median:                   sort → -12  48  49  50  51 → the middle one is 49      ✓
```

With an average, one faraway battle pulls the whole war towards it. With a median, it's just one vote like any other battle. We take the median of longitudes and latitudes separately.

Longitude has one more trap: it goes round in a circle. 179°E and 179°W (= −179°) are only 2° apart, but their normal average is 0°, which is in Africa. So first we compute the **circular mean**: we turn each longitude into a direction on a circle, add the directions, and read the angle of the sum with `atan2`, which turns a direction back into an angle:

```
longitudes:        179, -179
normal average:    (179 + -179) / 2 = 0°                                  ✗ Africa
circular mean:     atan2(sin 179 + sin -179, cos 179 + cos -179) = 180°   ✓ Pacific
```

Then we measure every longitude *relative to that mean*, so all of them are close together, and take the median of those. `((lon - ref + 540) % 360) - 180` does the measuring: it gives the shortest signed distance from `ref` to `lon`. With `ref = 180` and `lon = -179`: (−179 − 180 + 540) % 360 − 180 = 181 − 180 = **1**, meaning "1° east of the mean". Correct.

Why 540? It's 180 + 360. The +180 shifts the range so the final −180 can centre it again. The extra +360 keeps the number positive before `%`, because in JavaScript `-10 % 360` is `-10`, not 350.

### 2.4 Why SQLite?

We could keep the downloads in a JSON file. SQLite, a database in a single file, gives us three things for free:

- **Nothing is lost when a run crashes.** Each class is saved to disk as soon as its query returns. `fetch-wikipedia` skips what it already has, and `fetch-events` simply runs again.
- **Downloads are cached.** The export can run a hundred times without touching the network.
- **You can look inside with SQL**, which beats searching a 30 MB JSON file (we'll do it in a minute).

And it's built into Node 24, so there's nothing to install.

Here is all the SQL this project uses, in one place. A table has named columns and holds rows, like a spreadsheet:

| SQL | Meaning |
|---|---|
| `SELECT label, year FROM events WHERE year > 1000` | the `label` and `year` columns of every row where `year` is over 1000 |
| `label IN ('A', 'B')` | the label is one of these |
| `SELECT DISTINCT article` | each different value once |
| `FROM events e` … `e.*` | `e` is a short name for the table, and `e.*` means all its columns |
| `a.lon AS article_lon` | give this result column a new name |
| `TEXT`, `INTEGER`, `REAL` | column types: text, whole number, decimal number |
| `CREATE TABLE IF NOT EXISTS events (qid TEXT PRIMARY KEY, …)` | make the table unless it's already there. `PRIMARY KEY` means one row per `qid`. |
| `db.prepare('INSERT INTO events VALUES (?, ?, …)')` | a statement with `?` placeholders. `.run(a, b, …)` fills them in, safely. |
| `ON CONFLICT(qid) DO UPDATE SET category = min(category, excluded.category)` | if this `qid` already exists, don't fail. Update the existing row instead, and keep the lower category. `excluded` is the row we tried to insert. Insert-or-update like this is called an **upsert**. |
| `BEGIN` … `COMMIT` | a transaction: many inserts saved together, all or nothing, and about 100× faster than saving each one. |
| `INSERT OR REPLACE` | insert, or replace the row with the same key. |
| `WHERE article NOT IN (SELECT article FROM articles)` | only the rows we don't have yet. |
| `FROM events e JOIN articles a USING (article)` | glue each event to the article row with the same `article` value. |
| `coalesce(e.year_end, e.year)` | the end year, or the start year if there's no end, so an event with no end lasts 0 years. |

And the three Node calls around it:

- **`new DatabaseSync(path)`** opens the database file, and creates it if it's missing.
- **`db.exec(sql)`** runs SQL that returns nothing.
- **`db.prepare(sql).all()`** returns every row as an object, like `{ article: 'Battle_of_Hastings' }`.

### 2.5 The query, line by line

Here's the main query from the script below, one line at a time:

| Line | Meaning |
|---|---|
| `?e wdt:P31/wdt:P279* wd:${cls} ; wikibase:sitelinks ?sitelinks .` | `?e` is an instance of this class, or a subclass of it. Also get its sitelink count. |
| `?article schema:about ?e ; schema:isPartOf <https://en.wikipedia.org/> .` | `?article` is the English Wikipedia page about `?e`. Items without one are dropped, which is our minimum bar for being famous enough. |
| `?e rdfs:label ?label FILTER(LANG(?label) = "en")` | its English name |
| `OPTIONAL { ?e wdt:P625 ?coord }` | its own coordinates, if any |
| `OPTIONAL { ?e wdt:P276 ?loc . ?loc wdt:P625 ?locCoord }` | a location, and that location's coordinates |
| `OPTIONAL { ?e wdt:P585 ?time }` … `P580`, `P571`, `P582` | point in time, start, inception, end |

The second query, `subEventsQuery`, asks for every `?part` that is part of `?e` (`wdt:P361+`), with the part's own coordinates.

### 2.6 The script

Before you run it, put your real email in `USER_AGENT`. Wikimedia services ask every script to say who it is, and they block anonymous ones.

```ts
// scripts/fetch-events.ts
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { CATEGORIES } from '../src/model/categories.ts'

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

The parts that aren't obvious:

- **Folding the rows.** Every `OPTIONAL` can multiply the rows. An event with 2 coordinates, 3 locations and 2 dates comes back as 2 × 3 × 2 = 12 rows. So we fold them into one item per QID and keep the first value of each field. That's what `item.own ??= …` does: set it only if it's still empty.
- **The article name.** `?article` arrives as a URL, like `https://en.wikipedia.org/wiki/Battle_of_Hastings`. We keep the part after `/wiki/`, and `decodeURIComponent` turns escapes like `%C3%A9` back into é. That's why our article names have underscores.
- **`start ?? time ?? inception`.** For most battles only `time` exists. But World War I has *both* a start (1914) and a point in time (1918). If the point in time won, WWI would be a 1918 event. So the start comes first.
- **`medianPoint`** is the median and circular mean trick from §2.3. `values.length >> 1` is a fast way to write `Math.floor(values.length / 2)`, the index of the middle.
- **The control characters.** A few labels contain invisible characters that make `JSON.parse` fail, so we replace them with spaces first.
- **Retries.** QLever is a free shared service, and sometimes it's busy. The script waits 15 s, then 30 s, and gives up after 3 tries. If that happens, wait a minute and run it again.

Run it with `node scripts/fetch-events.ts`. It prints one line per class:

```
✓ battle Q178561: 12842 items
✓ war Q198: 1986 items
✓ politics Q131569: 3004 items
✓ politics Q10931: 155 items
✓ disaster Q8065: 3391 items
✓ founding Q515: 29556 items
```

Now look inside the database. macOS has the `sqlite3` command. On Linux, install it with `sudo apt install sqlite3`:

```bash
sqlite3 data/history.sqlite "SELECT label, year, year_end, parts FROM events WHERE label IN ('World War I', 'World War II', 'Battle of Hastings')"
```

```
Battle of Hastings|1066||0
World War I|1914|1918|604
World War II|1939|1945|1124
```

`|` separates the columns, and an empty column means NULL: Hastings has no end year. The start dates are right, and the wars have hundreds of located sub-events.

---

## 3. How important is it? In-degree

Here's the core idea of the whole app: **an event is as important as the number of Wikipedia articles that link to it.**

1,838 other English articles link to the Battle of Hastings article: articles about kings, castles, Norman history and so on. That number is its **in-degree**. It works surprisingly well, because editors link to what matters.

Wikipedia's search engine (called **CirrusSearch**) stores that number for every page, as `incoming_links`, and the Wikipedia API can return it. Ask for two articles at once:

```bash
curl -s 'https://en.wikipedia.org/w/api.php?action=query&prop=cirrusdoc|coordinates&cdincludes=incoming_links&coprimary=primary&colimit=max&titles=Battle_of_Hastings|Battle_of_Marathon&format=json&formatversion=2'
```

The real answer, shortened:

```json
{ "query": {
  "normalized": [{ "from": "Battle_of_Hastings", "to": "Battle of Hastings" }, …],
  "pages": [
    { "title": "Battle of Marathon",
      "cirrusdoc": [{ "source": { "incoming_links": 895 } }],
      "coordinates": [{ "lat": 38.11805556, "lon": 23.97833333, "primary": true }] },
    { "title": "Battle of Hastings",
      "cirrusdoc": [{ "source": { "incoming_links": 1838 } }] }
  ] } }
```

Every parameter is there for a reason:

- **`prop=cirrusdoc|coordinates`**: get the in-degree *and* the article's coordinates in the same request. On Wikipedia, editors add coordinates with a template called `{{coord}}`, and this returns them.
- **`cdincludes=incoming_links`**: return only that one field of the search data. Without it, a request is 2.5 MB instead of 24 KB.
- **`colimit=max`**: by default the API returns coordinates for only *10 pages per request*. We ask for 50 pages at a time, so without this, 40 of them silently get no coordinates.
- **`coprimary=primary`**: only the main coordinate of each article.
- **`titles=A|B|…`**: up to 50 titles per request, separated by `|`.
- **`normalized`**: the API rewrites `Battle_of_Hastings` to `Battle of Hastings`. We stored the version with underscores, so we use this list to map each answer back to our name.

We also want to be polite:

- **at most 4 requests at the same time;**
- **when Wikipedia answers `429 Too Many Requests`, we wait** as many seconds as its `Retry-After` header says.

Put your email in this script's `USER_AGENT` too.

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

How the "4 at a time" works: `batches` is one shared list of batches. We start 4 loops, and each loop keeps taking the next batch (`batches.shift()`) until the list is empty. So there are always at most 4 requests in flight, and a fast loop simply does more batches.

Run it with `node scripts/fetch-wikipedia.ts`. With 29,078 articles, that's 582 requests. It prints nothing for several minutes, then:

```
29078 articles to fetch
✓ done
```

If it crashes or you stop it, just run it again. It only asks for the articles it doesn't have yet. A batch that fails 5 times is skipped, and the next run picks it up.

---

## 4. Decisions: score, position, one binary file

Now all the facts are in SQLite. The export script turns them into the files the browser loads, and it makes every decision on the way.

### 4.1 The score, and the template trap

In-degree has one ugly problem: **navigation templates**. A navigation template (a "navbox") is the box of links at the bottom of an article, and it's copied onto every article in its group. Put a small article into a navbox that's used on 40,000 pages, and it gets 40,000 "incoming links".

Real examples from the full dataset:

| Article | In-degree | Languages (sitelinks) | in-degree ÷ sitelinks^1.5 |
|---|---:|---:|---:|
| World War II | 217,991 | 291 | 44 |
| French Revolution | 15,567 | 195 | 6 |
| Battle of Hastings | 1,838 | 81 | 2.5 |
| 2017 Bishop International Airport incident | **41,750** | **2** | **14,761** |

Truly important events are written about in *many languages*, and template-inflated ones aren't. So we limit ("cap") the in-degree using the number of languages:

```
score = min(inlinks, 60 × sitelinks^1.5) × categoryWeight
```

Why 1.5 and why 60? The last column of the table shows it: real events stay below about 55, and inflated ones are far above. Other exponents fail:

- **With exponent 1**, the cap would be 60 × 291 = 17,460 for WWII. That would cut WWII from 217,991 links to 17,460, and punish the most important event of all.
- **With exponent 2**, an article in 20 languages could keep up to 60 × 20² = 24,000 links, so many inflated articles would pass untouched.
- **With 1.5**, WWII stays untouched (44 is under 60), and an article in 20 languages is capped at 5,367. The 60 leaves a little room above the ~55 that real events reach.

So WWII keeps all its links, and the airport incident is capped at 60 × 2^1.5 = 170.

The **category weight** fixes a different problem. A *founding* is ranked by its city's article. London's 178,620 links are about modern London, not about its founding in 47 AD. Multiplying by 0.15 lets cities compete with events instead of drowning them.

Last, we drop everything with **fewer than 10 incoming links**. Nobody links to those articles, so nobody would miss them.

### 4.2 Position

The list from §2.3 becomes a function, `position()`. The first answer that exists wins:

1. the event's own coordinates;
2. its Wikipedia article's coordinates;
3. the median of its sub-events, but only when it has **at least 2**, since the "middle" of one point says nothing about a war;
4. its location.

An event with none of these is left out. No point on the map is better than a wrong one.

### 4.3 Why a binary file?

For each event, the browser needs a position, a start, an end, a score, an in-degree, a category, a name and a Wikipedia title. As JSON, that would be `[{"lon":23.97,"lat":38.11,"start":-490,…}, …]`. It's slow to parse, and it creates 23,000 objects we don't need as objects.

Instead, we write **columns** into one block of raw bytes: first all the positions, then all the starts, and so on. The browser reads it without parsing anything. Here's how raw bytes work in JavaScript:

```ts
const buf = new ArrayBuffer(8)            // 8 raw bytes, all zero
const floats = new Float32Array(buf, 0, 2) // look at them as 2 floats (4 bytes each), from byte 0
floats[0] = 1.5
new Uint8Array(buf)                        // [0, 0, 192, 63, 0, 0, 0, 0]: the same memory, seen as bytes
```

An `ArrayBuffer` is just bytes. A **typed array** like `Float32Array` is a *view*: a way to read and write those bytes as numbers of one type. Creating a view copies nothing. In `new Float32Array(buffer, byteOffset, length)`:

- the second argument is where to start, **in bytes**;
- the third is how many **numbers** to include, not bytes.

The types we use are `u32` (an unsigned 32-bit integer, 4 bytes), `f32` (a 32-bit float, 4 bytes) and `u8` (one byte, 0 to 255).

Here's our file with 3 events (n = 3):

```
byte  0 ┌────────────┐
        │ u32  n = 3 │  new Uint32Array(buffer, 0, 1)
byte  4 ├────────────┤
        │ f32 × 6    │  new Float32Array(buffer, 4, n * 2)         positions: lon0 lat0 lon1 lat1 lon2 lat2
byte 28 ├────────────┤
        │ f32 × 3    │  new Float32Array(buffer, 4 + n * 8, n)     start
byte 40 ├────────────┤
        │ f32 × 3    │  new Float32Array(buffer, 4 + n * 12, n)    end
byte 52 ├────────────┤
        │ f32 × 3    │  new Float32Array(buffer, 4 + n * 16, n)    score
byte 64 ├────────────┤
        │ f32 × 3    │  new Float32Array(buffer, 4 + n * 20, n)    inlinks
byte 76 ├────────────┤
        │ u8  × 3    │  new Uint8Array(buffer, 4 + n * 24, n)      category
byte 79 └────────────┘
```

Some details:

- **Why the byte offsets are `4 + n * 8`, `4 + n * 12`…** The count takes 4 bytes, and the positions take n × 2 numbers × 4 bytes = n × 8 bytes. So the starts begin at byte 4 + n × 8. Each later column adds n × 4 bytes.
- **Alignment.** A `Float32Array` view must start at a byte that's a multiple of 4. The header is 4 bytes and each float column is 4n bytes, so every float column starts on a multiple of 4. The one-byte column goes last, so it can't break that.
- **Why 32-bit floats, not 64-bit.** An `f32` stores a longitude or latitude to about 1 metre, and every year exactly. 64 bits would double the file for nothing.
- **Strings go to a small JSON file next to it.** Only the UI needs the names.

And the most important detail: **rows are sorted by score, most important first.** From now on "row 0" means "the most important event in history". Every algorithm in the app walks from the top and stops early.

```ts
// scripts/export-events.ts
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { CATEGORIES } from '../src/model/categories.ts'

const MIN_INLINKS = 10
const TEMPLATE_CAP = 60

type Row = {
  label: string; article: string; category: number; year: number; year_end: number; sitelinks: number; inlinks: number
  own_lon: number | null; own_lat: number | null; article_lon: number | null; article_lat: number | null
  parts: number; parts_lon: number | null; parts_lat: number | null; loc_lon: number | null; loc_lat: number | null
}

// The first position that exists wins.
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

// Layout: u32 count, then f32 columns [lon,lat]×n, start×n, end×n, score×n, inlinks×n, then u8 category×n.
const n = events.length
const buffer = new ArrayBuffer(4 + n * 24 + n)
new Uint32Array(buffer, 0, 1)[0] = n
const positions = new Float32Array(buffer, 4, n * 2)
const start = new Float32Array(buffer, 4 + n * 8, n)
const end = new Float32Array(buffer, 4 + n * 12, n)
const score = new Float32Array(buffer, 4 + n * 16, n)
const inlinks = new Float32Array(buffer, 4 + n * 20, n)
const category = new Uint8Array(buffer, 4 + n * 24, n)
events.forEach((e, i) => {
  positions[i * 2] = e.lon
  positions[i * 2 + 1] = e.lat
  start[i] = e.year
  end[i] = e.year_end
  score[i] = e.score
  inlinks[i] = e.inlinks
  category[i] = e.category
})

mkdirSync('public/data', { recursive: true })
writeFileSync('public/data/events.bin', new Uint8Array(buffer))
writeFileSync('public/data/events-meta.json', JSON.stringify({ label: events.map(e => e.label), article: events.map(e => e.article) }))
console.log(`✓ ${n} events, ${(buffer.byteLength / 1e6).toFixed(1)} MB. Top: ${events.slice(0, 5).map(e => e.label).join(' · ')}`)
```

Run it with `node scripts/export-events.ts`:

```
✓ 22778 events, 0.6 MB. Top: World War II · World War I · American Civil War · Bangladesh Liberation War · New York City
```

The whole pipeline took 9 minutes on my machine, most of it the Wikipedia step. From now on, `npm run data` runs all three scripts in order.

---

## 5. Time: a log scale and "the moment"

Now we start `src/model/`: plain functions with no browser, no React and no MapLibre. Everything else is built on top of it.

### 5.1 A log scale

History is uneven. The 20th century has far more recorded events per year than 2000 BC. On a normal ("linear") bar from 3000 BC to 2026, the whole 20th century would get 2% of the width, and antiquity 60%.

So the position on the bar, `t` (0 on the left, 1 on the right), is the **logarithm of "years before today"**:

```
t(year) = (ln(5176) − ln(2026 − year + 150)) / (ln(5176) − ln(150))
```

- **2026 − year** is "years before today".
- **+150** is a number we call **K**. It stops "today" from being at infinity, since ln(0) = −∞.
- **5176** is 2026 − (−3000) + 150: the value for 3000 BC. It makes that year land exactly on t = 0.

Here are real values:

| Year | 3000 BC | 1000 BC | 1 AD | 1000 | 1500 | 1800 | 1900 | 2000 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| **t, log scale** | 0.000 | 0.138 | 0.245 | 0.418 | 0.575 | 0.740 | 0.828 | 0.955 | 1.000 |
| **t, linear scale** | 0.000 | 0.398 | 0.597 | 0.796 | 0.895 | 0.955 | 0.975 | 0.995 | 1.000 |

K is a dial that decides how much room the recent past gets:

| K | the last 10 years get | antiquity (to 1 AD) gets | the last 200 years get |
|---:|---:|---:|---:|
| 10 | 11.1% | 15% | 49% |
| **150** | **1.8%** | **24%** | **24%** |
| 1000 | 0.6% | 38% | 10% |

With K = 150, antiquity and the last two centuries get the same room, a quarter of the bar each. That's roughly how the events are spread.

### 5.2 The moment

Where you are in time is described by three things:

- the **playhead year**: the year you're pointing at;
- the **span**: how many years around it you look at. The buttons offer 1, 10, 25, 50, 100 and 500, and the mouse wheel gives any span in between;
- the **window**: the years from `year − span/2` to `year + span/2`. Only the events in the window are shown.

```ts
momentAt(1066, 100)   // { year: 1066, span: 100, timeWindow: [1016, 1116] }
momentAt(1942, 500)   // { year: 1942, span: 500, timeWindow: [1692, 2026] }   ← cut off at 2026
```

Look at the second line. The window would end in 2192, so it's **cut off** at 2026. It is *not* moved back to [1526, 2026]. Why does that matter? The borders and the map colours follow the **playhead**, and the playhead must stay where you put it.

The full app once got this wrong. It moved the window back to [1526, 2026] and used its middle as the year. On the log bar, that middle is 1864. So pressing "500" in 1942 drew the borders of the 1800s under World War II bubbles.

Every move in the app builds its moment with `momentAt`, so the three numbers always agree:

```ts
// src/model/time.ts
export const YEAR_MIN = -3000
export const YEAR_MAX = 2026

export type TimeWindow = [start: number, end: number]

const K = 150
const FAR = Math.log(YEAR_MAX - YEAR_MIN + K)
const NEAR = Math.log(K)

// Position on the timeline bar (0..1) is the log of "years before today". K keeps today off infinity.
export const yearToT = (year: number) => (FAR - Math.log(YEAR_MAX - year + K)) / (FAR - NEAR)
export const tToYear = (t: number) => YEAR_MAX + K - Math.exp(FAR - t * (FAR - NEAR))

// Where you are in time: a playhead year, a span of years around it, and the window of events they cover.
export type Moment = { year: number; span: number; timeWindow: TimeWindow }

export function momentAt(year: number, span: number): Moment {
  const s = Math.min(Math.max(span, 1), YEAR_MAX - YEAR_MIN)
  const y = Math.min(Math.max(year, YEAR_MIN), YEAR_MAX)
  return { year: y, span: s, timeWindow: [Math.max(YEAR_MIN, y - s / 2), Math.min(YEAR_MAX, y + s / 2)] }
}

// Our years skip zero the way historians count: -1 is 1 BC.
export function formatYear(year: number) {
  const y = Math.round(year)
  return y < 0 ? `${-y} BC` : y < 1000 ? `${Math.max(y, 1)} AD` : `${y}`
}
```

### 5.3 Reading the binary file

`parseEvents` is the mirror image of the export: the same byte offsets, but now it creates views instead of writing. It's separate from `loadEvents`, which does the downloading, so the pure part also works in Node. We use that in the next section.

Why does `fetch('/data/events.bin')` find the file? Vite serves everything in the `public/` folder at the root of the site, so `public/data/events.bin` becomes `/data/events.bin`.

```ts
// src/model/events.ts
export type EventsData = {
  count: number
  positions: Float32Array
  start: Float32Array
  end: Float32Array
  score: Float32Array
  inlinks: Float32Array
  category: Uint8Array
  label: string[]
  article: string[]
}

type Meta = { label: string[]; article: string[] }

// Views into one buffer, no copying: the offsets mirror the layout written by export-events.ts.
export function parseEvents(buffer: ArrayBuffer, meta: Meta): EventsData {
  const n = new Uint32Array(buffer, 0, 1)[0]
  return {
    count: n,
    positions: new Float32Array(buffer, 4, n * 2),
    start: new Float32Array(buffer, 4 + n * 8, n),
    end: new Float32Array(buffer, 4 + n * 12, n),
    score: new Float32Array(buffer, 4 + n * 16, n),
    inlinks: new Float32Array(buffer, 4 + n * 20, n),
    category: new Uint8Array(buffer, 4 + n * 24, n),
    ...meta,
  }
}

export async function loadEvents() {
  const [buffer, meta] = await Promise.all([
    fetch('/data/events.bin').then(r => r.arrayBuffer()),
    fetch('/data/events-meta.json').then(r => r.json() as Promise<Meta>),
  ])
  return parseEvents(buffer, meta)
}
```

The era colours are plain data too. `epochAt(year)` returns the last era that started before `year`:

```ts
// src/model/epochs.ts
export type Epoch = { name: string; from: number; sea: string; land: string; border: string; ink: string }

export const EPOCHS: Epoch[] = [
  { name: 'Antiquity', from: -3000, sea: '#cdb98f', land: '#efe2c4', border: '#8a6a44', ink: '#3b2a1a' },
  { name: 'Middle Ages', from: 500, sea: '#34506f', land: '#f2e7cd', border: '#b08d3c', ink: '#2b1b12' },
  { name: 'Age of Sail', from: 1500, sea: '#d7cfb8', land: '#f6efdc', border: '#8b3a2b', ink: '#2d2a26' },
  { name: 'Modern', from: 1900, sea: '#0f1c2b', land: '#23344a', border: '#6fd3f5', ink: '#e8ecf1' },
]

export const epochAt = (year: number) => EPOCHS.findLast(e => e.from <= year) ?? EPOCHS[0]
```

---

## 6. What matters in a moment: ranking

Take the window 150–250 AD and list its events in row order, which is score order:

```
Zurich (200)                      2070
Newcastle upon Tyne (200)         1614
Roman–Persian Wars (54 BC–628)    1105    ← in every window for 700 years
Marcomannic Wars (166–180)         705
Yellow Turban Rebellion (184–205)  666
```

The Roman–Persian Wars lasted 682 years. Ranked like this, they're near the top of **every** window between 54 BC and 628 AD. That's true, but it's useless: you want to know what happened *in these years*.

The fix is one idea: **an event's score is spread over the years it lasted, and a window gets the part that falls inside it.** We call that part the **share**, and the result the **window score**:

```
share        = (years of the event inside the window + 1) / (years the event lasted + 1)
window score = score × share
```

The `+1` counts years inclusively: an event in a single year lasts 1 year, not 0.

Some real numbers:

- **A battle** lasts one year. Inside any window, its share is 1, so it keeps its full score.
- **The Roman–Persian Wars in 150–250:** (100 + 1) / (682 + 1) = **0.148**. The window score is 1105 × 0.148 = 163, and they drop out of the top 5.
- **The same wars in 500 BC–500 AD:** the share is 0.81. Look at the whole era and they matter again. **The ranking follows the scale you're looking at.**
- **WWII (1939–1945) in 1940–1942:** (2 + 1) / (6 + 1) = 3/7. That's still enough to beat any single battle of those years, as it should be.

### 6.1 Ranking a window fast

To rank a window, we sort its events by window score. The window changes on every frame while you drag, so this should be cheap. Two facts help:

- The rows are **already sorted by score** (§4.3).
- An event **completely inside** the window has share 1, so its window score *is* its score.

So the events completely inside the window are already in the right order. Only the ones that stick out past an edge need sorting, and there are few of them. Then we merge the two sorted lists, like the last step of merge sort:

```
inside   (already sorted):         A 900   B 500   C 120
partial  (sorted by window score): W 600   V 80
merged:                            A 900   W 600   B 500   C 120   V 80
```

How much does it save? For the 15,728 events of 1776–2026 in our data, a full sort takes 0.35 ms and `rankWindow` takes 0.19 ms. That's about half: nice, but not magic.

The real win is **`headlineOf`**, which finds only the top event. It walks from row 0 and **stops** as soon as a row's full score is lower than the best window score found so far. No row below can do better, because its window score is at most its full score. For 1776–2026 it looks at **1 row** (World War II) instead of 22,778. For 150–250 it looks at 253.

```ts
// src/model/rank.ts
import type { EventsData } from './events.ts'
import type { TimeWindow } from './time.ts'

// An event's score is spread over the years it lasted. A window gets the share it covers.
export function shareOf(events: EventsData, i: number, [start, end]: TimeWindow) {
  const overlap = Math.min(events.end[i], end) - Math.max(events.start[i], start)
  return (Math.max(0, overlap) + 1) / (events.end[i] - events.start[i] + 1)
}

// The window's events, most important first. Rows are pre-sorted by full score and a share is at most 1,
// so events wholly inside the window are already in order. Only the ones sticking out get sorted, then merged in.
export function rankWindow(events: EventsData, window: TimeWindow): number[] {
  const [start, end] = window
  const inside: number[] = []
  const partial: { i: number; score: number }[] = []
  for (let i = 0; i < events.count; i++) {
    if (events.start[i] > end || events.end[i] < start) continue
    if (events.start[i] >= start && events.end[i] <= end) inside.push(i)
    else partial.push({ i, score: events.score[i] * shareOf(events, i, window) })
  }
  partial.sort((a, b) => b.score - a.score)
  const ranked: number[] = []
  let p = 0
  for (const i of inside) {
    while (p < partial.length && partial[p].score > events.score[i]) ranked.push(partial[p++].i)
    ranked.push(i)
  }
  for (; p < partial.length; p++) ranked.push(partial[p].i)
  return ranked
}

// Just the top one. Once a row's full score can't beat the best window score found so far, no later row can either.
export function headlineOf(events: EventsData, window: TimeWindow): number | null {
  const [start, end] = window
  let best: number | null = null
  let bestScore = 0
  for (let i = 0; i < events.count && events.score[i] > bestScore; i++) {
    if (events.start[i] > end || events.end[i] < start) continue
    const score = events.score[i] * shareOf(events, i, window)
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  }
  return best
}
```

### 6.2 Checkpoint: ask questions in Node

Because `model/` has no browser code, we can use it before any UI exists. This little script prints the top events around any year, sorted by window score (score × share):

```ts
// scripts/explore.ts
import { readFileSync } from 'node:fs'
import { parseEvents } from '../src/model/events.ts'
import { headlineOf, rankWindow, shareOf } from '../src/model/rank.ts'
import { formatYear, momentAt } from '../src/model/time.ts'

const [year = '1066', span = '100'] = process.argv.slice(2)
const file = readFileSync('public/data/events.bin')
const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
const events = parseEvents(buffer, JSON.parse(readFileSync('public/data/events-meta.json', 'utf8')))

const { timeWindow } = momentAt(Number(year), Number(span))
const ranked = rankWindow(events, timeWindow)
console.log(`${formatYear(timeWindow[0])} – ${formatYear(timeWindow[1])}: ${ranked.length} events, headline: ${events.label[headlineOf(events, timeWindow)!]}`)
for (const i of ranked.slice(0, 8))
  console.log(`  ${formatYear(events.start[i]).padEnd(8)} ${events.label[i].slice(0, 36).padEnd(37)} score ${String(Math.round(events.score[i])).padStart(6)} × share ${shareOf(events, i, timeWindow).toFixed(2)}`)
```

One line needs a word: `file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)`. A Node `Buffer` is a view onto an `ArrayBuffer` that can be *bigger* than your file, since Node packs small files together. `parseEvents` reads byte offsets from the start of the `ArrayBuffer`, so we cut out exactly our bytes first.

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

Read these like a historian:

- **1016–1116.** The Battle of Hastings is there with its full score. The **Crusades** (1095–1291) get only 11% of this window, because most of them happened later. So they come 8th, even though their full score (8,405) is the biggest of the century.
- **1937–1947.** The Spanish Civil War (1936–1939) sticks out of the window by a year, so it gets 3/4 of its score.
- **Oslo** leads 1016–1116, and **Zurich** leads 150–250. Foundings are weakened, not removed. The weight in `categories.ts` is a dial: lower it and battles take over.

That's the heart of the app, working in a terminal. Everything from here on is about showing it.

---

## 7. State: one store and one owner of change

### 7.1 Why the store lives outside React

A screen redraws 60 times per second, so each frame has 16 ms. Dragging the timeline changes the time window on *every* frame, and then the map and the timeline must redraw. If each change went through React (change state, re-render components, run effects), we would pay for re-rendering components that don't care.

So we use a **zustand store** from `zustand/vanilla`, which works without React:

- **`createStore(() => ({ … }))`** takes a function that returns the first state.
- **`store.getState()`** returns the current state object.
- **`store.setState({ selected: 3 })`** *merges* the new fields into the state. The other fields stay. Every listener is then called.
- **`store.subscribe((state, prev) => …)`** calls your function after every change, with the new and the previous state. It returns a function that stops listening.

```ts
store.subscribe((state, prev) => {
  if (state.timeWindow !== prev.timeWindow) redrawTheMap()   // no React involved
})
```

That `!==` test is safe for one reason: **we never change state in place.** We always give zustand new objects and arrays (`momentAt` builds a new `timeWindow` every time). So "did it change?" is a cheap comparison of two references.

The map and the timeline subscribe like this, directly. React components use `useStore(store, s => s.year)` from the `zustand` package instead. It re-renders a component only when *its* value changes.

### 7.2 The camera is a command, not a guess

Who decides when the map flies somewhere? A tempting design: the map watches `selected` and flies whenever it changes. But clicking a bubble shouldn't move the camera, because the bubble is already under your mouse. Picking an event from the timeline should. From `selected` alone, the map can't tell the two cases apart.

So the camera is an **explicit command** in the store: `camera: { index, mode }`. The code that knows *why* the selection changed writes the command, and the map just carries it out. Every command is a new object, so asking twice for the same event still moves the camera twice.

```ts
// src/state/store.ts
import { createStore } from 'zustand/vanilla'
import { momentAt, type Moment } from '../model/time.ts'

export type AtlasState = Moment & {
  selected: number | null
  // How many bubbles the screen may hold.
  detail: number
  // A request for the map's camera. A new object is a new request, even for the same event.
  camera: { index: number; mode: 'reveal' | 'glide' } | null
  playing: boolean
  playSpeed: number
  autoExplore: boolean
  // What the last placement pass did, for the header.
  lod: { shown: number; population: number; minInlinks: number }
}

export const store = createStore<AtlasState>(() => ({
  ...momentAt(1750, 100),
  selected: null,
  detail: 120,
  camera: null,
  playing: false,
  playSpeed: 10,
  autoExplore: true,
  lod: { shown: 0, population: 0, minInlinks: 0 },
}))
```

### 7.3 Navigation: every way the view moves

One module owns the selection, the moment and the camera. Everything else asks it to go somewhere.

- **`select(i)`** opens or closes an event where it is, like when you click a bubble. The camera doesn't move.
- **`focus(events, i)`** jumps to an event from anywhere, like from the timeline's chronicle. If the event is outside the window, time moves to it and keeps the span. Then it asks the map to `reveal` the event.
- **`play(events)`** moves time forward. It uses **`requestAnimationFrame(fn)`**, which means "call `fn` just before the screen draws its next frame, and pass it the current time in milliseconds". `step` asks for the next frame at its end, so it runs once per frame until we stop it.
  - Each frame moves the playhead by `playSpeed × seconds since the last frame`. Because it uses real time and not a frame count, "10 years per second" is the same on a 60 Hz and a 120 Hz screen.
  - With auto-explore on, when the most important event of the window changes, it opens and the camera glides to it. That happens at most every 3.5 s, so you have time to read.
- **`keepSelectionInTime(events)`** enforces one rule forever: **the open event is always inside the time window.** Drag time away from it and it closes. Without this, a 2011 war stays on the map while you're looking at 463 BC. That happened in the full app too.

```ts
// src/state/navigation.ts
import type { EventsData } from '../model/events.ts'
import { headlineOf } from '../model/rank.ts'
import { momentAt, YEAR_MAX } from '../model/time.ts'
import { store } from './store.ts'

export const PLAY_SPEEDS = [1, 2, 5, 10, 25, 50, 100]
const HEADLINE_EVERY_MS = 3500
let playFrame = 0

// Open or close an event where it is: the camera stays put.
export function select(i: number | null) {
  pause()
  store.setState({ selected: i })
}

// Jump to an event from anywhere: re-centre time on it if it's outside the window, and ask the map to show it.
export function focus(events: EventsData, i: number) {
  pause()
  const { timeWindow: [start, end], span } = store.getState()
  const inside = events.start[i] <= end && events.end[i] >= start
  store.setState({ selected: i, camera: { index: i, mode: 'reveal' }, ...(inside ? {} : momentAt(events.start[i], span)) })
}

// Time moves at playSpeed years per second. With autoExplore, each new headline opens and the camera glides to it.
export function play(events: EventsData) {
  pause()
  store.setState({ playing: true, selected: null })
  let last = performance.now()
  let lastHeadline = -Infinity
  playFrame = requestAnimationFrame(function step(now) {
    const { year, span, playSpeed, autoExplore, selected } = store.getState()
    const years = (playSpeed * (now - last)) / 1000
    last = now
    if (year + years >= YEAR_MAX) return pause()
    const next = momentAt(year + years, span)
    const headline = autoExplore ? headlineOf(events, next.timeWindow) : null
    const opens = headline !== null && headline !== selected && now - lastHeadline > HEADLINE_EVERY_MS
    if (opens) lastHeadline = now
    store.setState({ ...next, ...(opens ? { selected: headline, camera: { index: headline, mode: 'glide' as const } } : {}) })
    playFrame = requestAnimationFrame(step)
  })
}

export function pause() {
  if (!store.getState().playing) return
  cancelAnimationFrame(playFrame)
  store.setState({ playing: false })
}

// The open event always lies inside the time window: move time off it and it closes.
export function keepSelectionInTime(events: EventsData) {
  return store.subscribe(({ timeWindow: [start, end], selected }) => {
    if (selected !== null && (events.start[selected] > end || events.end[selected] < start)) store.setState({ selected: null })
  })
}
```

### 7.4 Checkpoint: navigation in Node

The store and navigation don't need a browser either, so let's try them:

```ts
// scripts/check-state.ts
import { readFileSync } from 'node:fs'
import { parseEvents } from '../src/model/events.ts'
import { momentAt } from '../src/model/time.ts'
import { focus, keepSelectionInTime } from '../src/state/navigation.ts'
import { store } from '../src/state/store.ts'

const file = readFileSync('public/data/events.bin')
const events = parseEvents(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), JSON.parse(readFileSync('public/data/events-meta.json', 'utf8')))
keepSelectionInTime(events)

const show = (title: string) => {
  const { year, timeWindow, selected, camera } = store.getState()
  console.log(title.padEnd(26), { year, timeWindow, selected: selected === null ? null : events.label[selected], camera })
}

show('at start:')
focus(events, events.label.indexOf('Battle of Hastings'))
show('after focus(Hastings):')
store.setState(momentAt(1500, 100))
show('after moving to 1500:')
```

Run `node scripts/check-state.ts`:

```
at start:                  {
  year: 1750,
  timeWindow: [ 1700, 1800 ],
  selected: null,
  camera: null
}
after focus(Hastings):     {
  year: 1066,
  timeWindow: [ 1016, 1116 ],
  selected: 'Battle of Hastings',
  camera: { index: 293, mode: 'reveal' }
}
after moving to 1500:      {
  year: 1500,
  timeWindow: [ 1450, 1550 ],
  selected: null,
  camera: { index: 293, mode: 'reveal' }
}
```

This shows `focus` doing three things at once:

1. It moves time from 1750 to the 100 years around 1066.
2. It selects the battle.
3. It writes a camera command, which a map will carry out later.

Then moving time to 1500 closes the battle by itself. The camera command is still there, but it's an old object, so the map won't run it again.

---

## 8. The globe: MapLibre and level of detail

### 8.1 MapLibre in five minutes

MapLibre draws our data using **GeoJSON**, the standard JSON format for map data. A point looks like this:

```json
{ "type": "FeatureCollection", "features": [
  { "type": "Feature",
    "geometry": { "type": "Point", "coordinates": [0.4875, 50.9119] },
    "properties": { "name": "Battle of Hastings", "radius": 6, "color": "#d63031" } }
] }
```

A **Feature** is one thing on the map: its **geometry** (where it is) plus any **properties** we like. A **FeatureCollection** is a list of them.

A MapLibre map is described by a **style**, a JSON object with two lists:

- **`sources`**: where the data comes from. Ours are all GeoJSON: land shapes, border shapes, and our events as points.
- **`layers`**: how to draw a source. They're drawn in order, bottom to top: `background` (the sea), `fill` (land), `line` (borders), `circle` (bubbles) and `symbol` (text).

A layer has two kinds of settings:

- **`paint`**: how it looks, like colours and widths;
- **`layout`**: what to draw and where, like the text, the font and the offset.

A value can be an **expression** that reads from each feature:

| Expression | Meaning |
|---|---|
| `['get', 'radius']` | this feature's `radius` property |
| `['case', ['get', 'selected'], 2.5, 0.6]` | 2.5 if `selected` is true, otherwise 0.6 |
| `['format', name, {}, '\n', {}, when, { 'font-scale': 0.8 }]` | the name, a new line, then the date at 80% size |
| `filter: ['get', 'labeled']` | draw only the features whose `labeled` is true |

So we compute sizes and colours in TypeScript and store them on the features, and the graphics card draws whatever we put there.

MapLibre's **zoom** is a number. At zoom 0 the whole world is about 512 px wide, and each +1 doubles that. We start at 1.6.

Two more style settings:

- **`projection: { type: 'globe' }`** turns the map into a sphere.
- **`glyphs`** is a URL for font files. Symbol layers need it to draw text.

### 8.2 Level of detail: deciding what fits

When the app starts, the window is 1700–1800, which holds 2,146 events. Draw them all and Europe is a red smear. MapLibre can hide overlapping labels by itself, but it doesn't know that the French Revolution matters more than a small siege. And its choices change from frame to frame while the globe turns, which makes things blink.

So **we** decide, in `placeEvents`. It's a pure function: it only sees a `Viewport`, which is a width, a height, a zoom level and a function "where is this lon/lat on screen, if it's visible?". It never touches MapLibre. It works in three steps.

First, two words. The **population** is how many events are in the window. The **target** is the most bubbles we want on screen: it's the store's `detail`, 120 at the start, and the Detail slider changes it.

**Step 1: the pool.** Only the top part of the window's ranking gets a chance:

```
pool = min(population,  max(population × min(1, 0.3 × 2^(zoom − 1.8)),  3 × target))
```

- **At zoom 1.8** the top 30% compete, and every zoom level doubles that. So **zooming in lowers the bar**, and the smaller events appear only when you look closely.
- **Real numbers:** we start at zoom 1.6, where the share is 0.3 × 2^(−0.2) = 26%. That's 561 of the 2,146 events. At zoom 3.8 the share is over 100%, so all 2,146 compete.
- **The `3 × target` minimum** protects quiet eras. 150–250 AD has only 78 events, and 26% of those wouldn't fill a screen. With the minimum, all 78 compete (the outer `min` stops at the population).

**Step 2: the order.** First the open event, so it's always drawn. Then the events **already on screen** from the last pass. Then the new ones. Each group is sorted by rank.

The code does this with one sort key:

- the open event gets −1;
- an event already on screen gets its rank;
- a new event gets its rank + population.

With 2,146 events, an on-screen event at rank 5 gets key 5, and a new event at rank 3 gets 3 + 2,146 = 2,149, so it comes after.

Why does this stop blinking? An event that's shown stays shown while it still fits. A slightly more important neighbour that slides into view doesn't push it out.

**Step 3: the greedy fit.** "Greedy" means we decide about each candidate once, in order, and never go back. For each candidate:

1. Its bubble is a box.
2. If the box overlaps nothing we kept before, we keep it. Otherwise we drop it.
3. A kept bubble also gets a label if its label box fits too, until 30 labels are placed. We guess the label's width as 6.5 px per character, which is close enough for 12 px text.

```
candidates in order:  A (rank 0) at (100,100)   B (rank 1) at (104,102)   C (rank 2) at (300,80)
A: nothing kept yet               → keep A, give it a label
B: its box overlaps A's box        → drop B
C: overlaps nothing                → keep C, give it a label
```

- **The overlap test.** Two boxes don't overlap if one is completely to the left, right, top or bottom of the other: `box[0] >= b[2] || box[2] <= b[0] || box[1] >= b[3] || box[3] <= b[1]`.
- **The grid.** Testing each new box against every box kept so far gets slow. So we split the screen into **cells of 64 × 64 px**, and remember which boxes touch which cells. A new box is then tested only against the boxes in its own cells. `cy * 10_000 + cx` turns a cell's (x, y) into one number we can use as a `Map` key.

Finally, the **bubble size** comes from the event's **percentile in the window**. The top event has percentile 1, the middle one 0.5, the last one close to 0. The radius is `3 + 7 × percentile³`:

- percentile 1 → 10 px;
- 0.8 → 6.6 px;
- 0.5 → 3.9 px.

So the top event of 2000 BC is as big as the top event of 1942, even though modern events have 100× more links. Cubing keeps only the real stars big.

```ts
// src/map/placement.ts
import type { EventsData } from '../model/events.ts'

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
    const at = viewport.locate(events.positions[i * 2], events.positions[i * 2 + 1])
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

### 8.3 The atlas: the map, connected to the store

`createAtlas` creates the map and connects it to the store. The parts worth explaining:

- **Hiding the back of the globe.** `map.project()` also returns screen positions for points on the *back* of the globe, and we would draw them. So `locate` first checks that the point faces us. Picture two arrows from the centre of the Earth: one to the point, one to the centre of your view. The **dot product** of the two arrows is the cosine of the angle between them, and the long line in `locate` is exactly that dot product, written with latitudes and longitudes.
  - We keep a point only if the cosine is above 0.3, which is an angle under about 72°. London, seen from a view centred on Tokyo, is 86° away: cos = 0.07, so it's hidden.
  - Why not 0, the real horizon? Near the edge of the globe, bubbles get squashed and crowd together.
- **A throttle.** `schedule()` starts a 100 ms timer, but only if none is running, so many changes in a burst cause one `place()`. (The other kind of "later", once per frame, is in §9.) In between, MapLibre keeps moving the placed bubbles with the globe on every frame, so it still looks smooth.
- **`place` starts on `'load'`.** The sources don't exist until the style has loaded. `'move'` fires on every frame of every camera movement, including animations, and that's what makes placement follow the globe.
- **The ranking is cached per window.** Panning or zooming doesn't change the ranking, only the placement.
- **Eras change colours in place.** `setStyle` would reload everything, and the map would flash. `setPaintProperty` changes one colour on data that's already on the graphics card.
- **Borders come straight from GitHub.** The [historical-basemaps](https://github.com/aourednik/historical-basemaps) project has world borders for 48 moments in history. We show the latest one at or before the playhead. `setData(url)` lets MapLibre's worker download and read the file, off the main thread.
- **The camera.** `camera[state.camera.mode](index)` picks the function by name:
  - **`flyTo`** zooms out and back in along a curve, which is good for big jumps;
  - **`easeTo`** slides straight there, which is good for Play's gentle following.
- **Clicks.** `queryRenderedFeatures` finds the bubble under the mouse, and we ask navigation to `select` it.
- **No loop.** `place()` writes `lod` to the store, which wakes our own subscriber. It only reacts to the window, the selection, the detail and the camera, so writing `lod` doesn't start another pass.
- **The worker URL.** Once Vite bundles MapLibre, MapLibre can't find its own worker file. `import workerUrl from '…?worker&url'` asks Vite to bundle the worker and give us its URL, and `setWorkerUrl` hands that URL to MapLibre.

```ts
// src/map/atlas.ts
import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { CATEGORIES } from '../model/categories.ts'
import { epochAt, type Epoch } from '../model/epochs.ts'
import type { EventsData } from '../model/events.ts'
import { rankWindow } from '../model/rank.ts'
import { formatYear, type TimeWindow } from '../model/time.ts'
import { select } from '../state/navigation.ts'
import { store } from '../state/store.ts'
import { placeEvents, type Viewport } from './placement.ts'

maplibregl.setWorkerUrl(workerUrl)

const LAND = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson'
const BORDERS = 'https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson'
const SNAPSHOTS = [-3000, -2000, -1500, -1000, -700, -500, -400, -323, -300, -200, -100, -1, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1279, 1300, 1400, 1492, 1500, 1530, 1600, 1650, 1700, 1715, 1783, 1800, 1815, 1880, 1900, 1914, 1920, 1930, 1938, 1945, 1960, 1994, 2000, 2010]
const empty = { type: 'FeatureCollection' as const, features: [] }

function styleFor(epoch: Epoch): maplibregl.StyleSpecification {
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

export function createAtlas(container: HTMLElement, events: EventsData) {
  let epoch = epochAt(store.getState().year)
  let snapshot: number | null = null
  let ranking: { timeWindow: TimeWindow; ranked: number[] } | null = null
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
    const { year, timeWindow, selected, detail } = store.getState()

    // The era's look: swap paint in place instead of reloading the style.
    const next = epochAt(year)
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
    const at = SNAPSHOTS.findLast(y => y <= year) ?? SNAPSHOTS[0]
    if (at !== snapshot) {
      snapshot = at
      ;(map.getSource('borders') as maplibregl.GeoJSONSource).setData(`${BORDERS}/world_${at < 0 ? `bc${-at}` : at}.geojson`)
    }

    // Ranking depends only on the window, so a pan or zoom reuses it.
    if (ranking?.timeWindow !== timeWindow) ranking = { timeWindow, ranked: rankWindow(events, timeWindow) }
    const placed = placeEvents(events, viewport(), ranking.ranked, selected, detail, previous)
    previous = new Set(placed.map(p => p.index))

    ;(map.getSource('events') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: placed.map(p => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [events.positions[p.index * 2], events.positions[p.index * 2 + 1]] },
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
    store.setState({ lod: { shown: placed.length, population: ranking.ranked.length, minInlinks: placed.length ? minInlinks : 0 } })
  }

  // Placement runs at most every 100 ms while things move. MapLibre keeps moving the bubbles every frame in between.
  const schedule = () => {
    if (!timer) timer = window.setTimeout(place, 100)
  }

  const lngLat = (i: number): [number, number] => [events.positions[i * 2], events.positions[i * 2 + 1]]
  const camera = {
    reveal: (i: number) => map.flyTo({ center: lngLat(i), zoom: Math.max(map.getZoom(), 3), duration: 1600 }),
    glide: (i: number) => map.easeTo({ center: lngLat(i), zoom: Math.max(map.getZoom(), 2.5), duration: 2400 }),
  }

  map.on('load', place)
  map.on('move', schedule)
  map.on('click', e => {
    const hit = map.queryRenderedFeatures(e.point, { layers: ['bubbles'] })[0]
    select(hit ? Number(hit.properties.index) : null)
  })
  const unsubscribe = store.subscribe((state, prev) => {
    if (state.timeWindow !== prev.timeWindow || state.selected !== prev.selected || state.detail !== prev.detail) schedule()
    if (state.camera && state.camera !== prev.camera) camera[state.camera.mode](state.camera.index)
  })

  return () => {
    unsubscribe()
    clearTimeout(timer)
    map.remove()
  }
}
```

### 8.4 Checkpoint: see the globe

We don't have the UI yet, but we can already look at the globe. Create a temporary `src/main.tsx` that mounts only the map. We'll replace it in §10.

```tsx
// src/main.tsx
import './index.css'
import { createAtlas } from './map/atlas.ts'
import { loadEvents } from './model/events.ts'

const events = await loadEvents()
createAtlas(document.getElementById('root')!, events)
```

Run `npm run dev` and open http://localhost:5173. You should see a cream-coloured globe (the Age of Sail palette) on a white page, the borders of 1715 (the last snapshot at or before the playhead, 1750), and a few dozen coloured bubbles with names: the French Revolution, Saint Petersburg, the Battle of Plassey… The dark background comes with the UI in §10. Drag to turn it, scroll to zoom, and watch more events appear.

---

## 9. The timeline: a canvas scrubber and the chronicle

The timeline draws 800 small bars, a lens, year labels and dozens of event names, and it redraws all of them on every frame while you drag. One `<canvas>` does that easily, while a thousand HTML elements would not.

### 9.1 Canvas in six lines

A canvas is a picture you draw on with code. Everything is in pixels from the top-left corner:

```ts
const ctx = canvas.getContext('2d')!
ctx.fillStyle = 'red'
ctx.fillRect(10, 20, 100, 5)                        // a rectangle: x, y, width, height
ctx.beginPath(); ctx.arc(50, 50, 3, 0, Math.PI * 2); ctx.fill()   // a dot of radius 3
ctx.fillText('1066  Battle of Hastings', 60, 55)    // text; y is the text's baseline
ctx.measureText('Battle of Hastings').width         // how wide that text would be
```

### 9.2 The layout

Our canvas is 96 px tall and has two bands:

```
 y=6   ┌──────────────────────────────────────────────────────┐
       │ overview: 800 bars, the lens, the playhead           │  press here → move the playhead
 y=32  └──────────────────────────────────────────────────────┘
 y=45     2000 BC    1000 BC    500 BC    1 AD  …  1900  2000    year labels
 y=50  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─     OVERVIEW_BOTTOM: presses below hit the chronicle
 y=68        │1765 American Revolution                            row 1
 y=82   │1701 War of the Spanish Succession    │1775 American Revolutionary War   row 0
 y=88  ─●──────────────────────────────────●───────────●──────   the axis, with a dot per label
```

- **The overview** is all of history on the log scale. The **lens** is the orange box on it: it covers the time window, so its width is the span, and the thin line inside it is the playhead. Each little bar is the number of events that start in that slice of time, and it's bright inside the lens. The heights use `Math.log1p(count)`, which is log(1 + count), so the dense 20th century doesn't flatten antiquity to nothing. **Press or drag anywhere to move the playhead there**, like a video player, so there are no handles to aim for. The mouse wheel makes the span wider or narrower.
- **The chronicle** is the window stretched to the full width in normal years, with the **best events named in order**. It uses the same greedy idea as the map. Walk the window's ranking, and each label takes the first of two rows where it fits. A label on row 1 has a stem that goes down through row 0 to the axis, so we also reserve a 4 px slot for that stem on row 0 (`rows[0].push([x - 2, x + 2])`). Otherwise a row-0 label would be drawn across it. Click a name and it opens with `focus`.

### 9.3 The details

- **`xAt(t)` and `tAt(x)`** convert between a bar position (0–1) and a pixel, leaving a 12 px margin on each side.
- **`rankWindow(…).slice(0, 300)`**: two rows fill up long before 300 labels, so we don't measure more text than that.
- **The wheel.** `span × Math.exp(deltaY × 0.0015)`: one wheel notch is about deltaY = 100, so ×1.16, 16% wider. Scrolling the other way gives a negative deltaY and makes it narrower. `exp` makes every notch change the span by the same *percentage*.
- **The hit test.** A label's text sits around `AXIS - 10 - row × ROW_GAP`, and a press within 8 px of that, over the label's width, counts as a click on it.
- **`{ passive: false }`.** Normally the browser may scroll the page without waiting for our wheel code. `passive: false` tells it to wait. Then `preventDefault()` can stop the scroll, and the wheel changes the span instead.
- **`setPointerCapture`.** The drag keeps working when the mouse leaves the canvas.
- **The device pixel ratio.** A canvas has its own pixel size. On a retina screen one CSS pixel is 2 real pixels (`devicePixelRatio = 2`), and without adjusting, everything is blurry. So we make the canvas that many times bigger, and `ctx.setTransform(dpr, …)` lets us keep drawing in CSS pixels.
- **`ResizeObserver`** tells us when the canvas itself changes size, not only the window.
- **`redraw()`** asks for at most one draw per frame, even if the store changes five times in that frame. That's the second kind of "later", next to the atlas's 100 ms throttle.
- **`AbortController`.** In development, React's StrictMode starts every component twice to catch bugs. So our cleanup must remove every listener, or each wheel notch would zoom twice. Passing the same `signal` to every `addEventListener` lets `listeners.abort()` remove them all at once.

```ts
// src/timeline/timeline.ts
import { CATEGORIES } from '../model/categories.ts'
import type { EventsData } from '../model/events.ts'
import { rankWindow } from '../model/rank.ts'
import { formatYear, momentAt, tToYear, yearToT } from '../model/time.ts'
import { focus } from '../state/navigation.ts'
import { store } from '../state/store.ts'

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

export function createTimeline(canvas: HTMLCanvasElement, events: EventsData) {
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
  const moveTo = (year: number) => store.setState(momentAt(year, store.getState().span))

  // The window stretched to full width in plain years, with the best events labelled. Greedy, like the map:
  // in rank order, each label takes the first of two rows where it fits, and its stem must cross the lower row freely.
  function layoutChronicle() {
    const [start, end] = store.getState().timeWindow
    const rows: [number, number][][] = [[], []]
    const free = (row: number, a: number, b: number) => rows[row].every(([x0, x1]) => b <= x0 || a >= x1)
    labels = []
    ctx.font = '11px system-ui'
    for (const i of rankWindow(events, [start, end]).slice(0, 300)) {
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
    const { year, timeWindow: [start, end], selected } = store.getState()
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
    ctx.fillRect(xAt(yearToT(year)) - 1, BAR_TOP - 3, 2, BAR_BOTTOM - BAR_TOP + 6)
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

  const listeners = new AbortController()
  const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void) =>
    canvas.addEventListener(type, fn, { signal: listeners.signal, passive: false })
  on('pointerdown', e => {
    if (e.offsetY < OVERVIEW_BOTTOM) {
      dragging = true
      canvas.setPointerCapture(e.pointerId)
      moveTo(tToYear(tAt(e.offsetX)))
      return
    }
    const hit = labels.find(l => e.offsetX >= l.x - 3 && e.offsetX <= l.x1 && Math.abs(e.offsetY - (AXIS - 10 - l.row * ROW_GAP)) < 8)
    if (hit) focus(events, hit.i)
  })
  on('pointermove', e => dragging && moveTo(tToYear(tAt(e.offsetX))))
  on('pointerup', () => (dragging = false))
  on('wheel', e => {
    e.preventDefault()
    const { year, span } = store.getState()
    store.setState(momentAt(year, span * Math.exp(e.deltaY * 0.0015)))
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
  const unsubscribe = store.subscribe(redraw)

  return () => {
    listeners.abort()
    resize.disconnect()
    unsubscribe()
    cancelAnimationFrame(frame)
  }
}
```

---

## 10. The React UI and startup

The React part is thin on purpose. First, React in one minute:

- **A component** is a function that returns **JSX**: HTML-like syntax that's allowed in `.tsx` files. `className` is HTML's `class`, and `{expr}` puts a JavaScript value inside.
- **Props.** `<App events={events} />` calls `App({ events })`. That object is called the *props*.
- **`useState`.** `const [value, setValue] = useState(x)` keeps a value between renders. Calling `setValue` draws the component again.
- **`useRef`.** `useRef(null)` gives you an object `{ current }`. Put it on an element with `ref={r}`, and React sets `r.current` to the real DOM element.
- **`key`.** In a list, `key` tells React which item is which.
- **Rendering.** `createRoot(div).render(<App />)` puts the whole app into the page.

### 10.1 App

`App` gives the map a DOM element and puts the header, the panel and the timeline bar on top of it.

The key line is `useEffect(() => createAtlas(mapRef.current!, events), [events])`:

- **The effect.** React runs it after the element exists, so `mapRef.current` is the real div.
- **The cleanup.** `createAtlas` *returns* a function that destroys the map, and the arrow returns it to React. React calls it when the component goes away. In development, StrictMode mounts the component, destroys it and mounts it again, so that cleanup must undo *everything*: the map, the listeners, the subscription and the timer. All of ours do.
- **`[events]`** means "run again only if `events` changes", which never happens.

One trap cost me a blank screen twice. MapLibre's CSS gives the map element `position: relative`, and that quietly beats Tailwind's `absolute` on the same element. The map div then has zero height, the globe never appears, and placement reports "0 events", because nothing is visible. The fix: put the position on a wrapper div, and let the map element just fill it.

Note: `App` imports three components we write next. It won't compile until all four files exist.

```tsx
// src/ui/App.tsx
import { useEffect, useRef } from 'react'
import { createAtlas } from '../map/atlas.ts'
import type { EventsData } from '../model/events.ts'
import { EventPanel } from './EventPanel.tsx'
import { Header } from './Header.tsx'
import { TimelineBar } from './TimelineBar.tsx'

export function App({ events }: { events: EventsData }) {
  const mapRef = useRef<HTMLDivElement>(null)
  useEffect(() => createAtlas(mapRef.current!, events), [events])
  return (
    <div className="relative h-full overflow-hidden bg-[#0b0f14] text-white">
      {/* MapLibre's CSS sets position: relative on the map element, so it gets its own wrapper to fill the screen. */}
      <div className="absolute inset-0">
        <div ref={mapRef} className="h-full" />
      </div>
      <Header />
      <EventPanel events={events} />
      <TimelineBar events={events} />
    </div>
  )
}
```

### 10.2 Header

The header shows the window and the era, the span buttons, and the Detail slider, which is placement's `target`. It also shows the smallest in-degree on screen, so importance is a number you can see.

The whole header has `pointer-events-none`, so dragging over it still turns the globe. Only the buttons and the slider take clicks back, with `pointer-events-auto`.

```tsx
// src/ui/Header.tsx
import { useStore } from 'zustand'
import { epochAt } from '../model/epochs.ts'
import { formatYear, momentAt } from '../model/time.ts'
import { store } from '../state/store.ts'

const SPANS = [1, 10, 25, 50, 100, 500]

export function Header() {
  const year = useStore(store, s => s.year)
  const span = useStore(store, s => s.span)
  const [start, end] = useStore(store, s => s.timeWindow)
  const detail = useStore(store, s => s.detail)
  const lod = useStore(store, s => s.lod)
  return (
    <header className="pointer-events-none absolute top-5 left-6 drop-shadow">
      <div className="text-[11px] tracking-[0.3em] text-orange-300 uppercase">{epochAt(year).name}</div>
      <h1 className="font-serif text-5xl">{formatYear(start)} – {formatYear(end)}</h1>
      <div className="pointer-events-auto mt-3 flex items-center gap-1 text-xs">
        <span className="mr-2 opacity-60">Span</span>
        {SPANS.map(s => (
          <button key={s} onClick={() => store.setState(momentAt(year, s))} className={`rounded-full px-2 py-0.5 ${Math.round(span) === s ? 'bg-orange-300 text-black' : 'hover:bg-white/10'}`}>
            {s}
          </button>
        ))}
        <span className="ml-1 opacity-60">years</span>
      </div>
      <label className="pointer-events-auto mt-2 flex items-center gap-2 text-xs">
        <span className="opacity-60">Detail</span>
        <input type="range" min={25} max={600} value={detail} onChange={e => store.setState({ detail: Number(e.target.value) })} />
        <span className="opacity-70">≥ {lod.minInlinks.toLocaleString()} links</span>
      </label>
      <div className="mt-1 text-xs opacity-50">{lod.shown} of {lod.population.toLocaleString()} events in this span</div>
    </header>
  )
}
```

### 10.3 The event panel

The panel asks Wikipedia for a short summary of the article. Try it:

```bash
curl -s https://en.wikipedia.org/api/rest_v1/page/summary/Battle_of_Hastings
```

```json
{ "title": "Battle of Hastings",
  "thumbnail": { "source": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/bb/Bayeux_Tapestry_scene57…" },
  "extract": "The Battle of Hastings was fought on 14 October 1066 between the Norman-French army of William, Duke of Normandy, and an…" }
```

Three details in the code:

- **`key={selected}`** makes React build a fresh card for every event. Otherwise you'd see the previous event's text for a moment.
- **The `AbortController`** has a different job here than in §9: when you switch events before the summary arrives, it cancels the old request.
- **`.catch(() => {})`**: a cancelled request fails on purpose, and we ignore that.

```tsx
// src/ui/EventPanel.tsx
import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { CATEGORIES } from '../model/categories.ts'
import type { EventsData } from '../model/events.ts'
import { formatYear } from '../model/time.ts'
import { select } from '../state/navigation.ts'
import { store } from '../state/store.ts'

type Summary = { extract: string; thumbnail?: { source: string } }

export function EventPanel({ events }: { events: EventsData }) {
  const selected = useStore(store, s => s.selected)
  // Keyed by event, so switching events starts from an empty card instead of flashing the previous summary.
  return selected === null ? null : <Card key={selected} events={events} i={selected} />
}

function Card({ events, i }: { events: EventsData; i: number }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  useEffect(() => {
    const abort = new AbortController()
    fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(events.article[i])}`, { signal: abort.signal })
      .then(r => r.json())
      .then(setSummary)
      .catch(() => {})
    return () => abort.abort()
  }, [events, i])
  const category = CATEGORIES[events.category[i]]
  return (
    <aside className="absolute top-5 right-5 bottom-40 w-96 overflow-y-auto rounded-2xl bg-[#f6efdc] text-[#2d2a26] shadow-2xl">
      {summary?.thumbnail && <img src={summary.thumbnail.source} alt="" className="h-44 w-full object-cover" />}
      <div className="p-5">
        <div className="flex justify-between text-[11px] tracking-widest uppercase opacity-60">
          <span>
            <span style={{ color: category.color }}>●</span> {category.name} · {formatYear(events.start[i])}
          </span>
          <button onClick={() => select(null)}>✕</button>
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

### 10.4 The timeline bar

It holds Play, the auto-explore switch (◎), the speed buttons, and the canvas:

```tsx
// src/ui/TimelineBar.tsx
import { useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import type { EventsData } from '../model/events.ts'
import { pause, play, PLAY_SPEEDS } from '../state/navigation.ts'
import { store } from '../state/store.ts'
import { createTimeline } from '../timeline/timeline.ts'

export function TimelineBar({ events }: { events: EventsData }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const playing = useStore(store, s => s.playing)
  const speed = useStore(store, s => s.playSpeed)
  const autoExplore = useStore(store, s => s.autoExplore)
  const step = PLAY_SPEEDS.indexOf(speed)
  useEffect(() => createTimeline(canvas.current!, events), [events])
  return (
    <div className="absolute inset-x-5 bottom-5 flex h-28 items-center gap-3 rounded-2xl bg-black/55 px-3 backdrop-blur-md">
      <div className="flex w-24 shrink-0 flex-col items-center gap-2 text-xs">
        <div className="flex gap-1">
          <button onClick={() => (playing ? pause() : play(events))} className="size-9 rounded-full ring-1 ring-white/30">
            {playing ? '❚❚' : '▶'}
          </button>
          <button onClick={() => store.setState({ autoExplore: !autoExplore })} title="Auto-explore" className={`size-9 rounded-full ring-1 ${autoExplore ? 'text-orange-300 ring-orange-300/60' : 'opacity-50 ring-white/20'}`}>
            ◎
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button disabled={step === 0} onClick={() => store.setState({ playSpeed: PLAY_SPEEDS[step - 1] })} className="px-1 disabled:opacity-25">
            −
          </button>
          <span className="w-12 text-center">{speed} yr/s</span>
          <button disabled={step === PLAY_SPEEDS.length - 1} onClick={() => store.setState({ playSpeed: PLAY_SPEEDS[step + 1] })} className="px-1 disabled:opacity-25">
            +
          </button>
        </div>
      </div>
      <canvas ref={canvas} className="h-24 min-w-0 flex-1 touch-none" />
    </div>
  )
}
```

### 10.5 Startup

Now replace the temporary `src/main.tsx` from §8.4 with the real one. It loads the data, turns on the selection rule, and renders the app. The `await` at the top works because the file is an ES module: nothing renders until the data has loaded.

```tsx
// src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { loadEvents } from './model/events.ts'
import { keepSelectionInTime } from './state/navigation.ts'
import { App } from './ui/App.tsx'

const events = await loadEvents()
keepSelectionInTime(events)
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App events={events} />
  </StrictMode>,
)
```

---

## 11. Run it

```bash
npm run data     # only once: Wikidata → Wikipedia → events.bin (about 10 minutes). Skip it if you ran §2–§4.
npm run dev      # then open http://localhost:5173
```

**What you should see:** "1700 – 1800" in the top left, a cream-coloured Age of Sail globe with the borders of 1715, a few dozen bubbles, and the chronicle at the bottom: 1701 War of the Spanish Succession, 1740 War of the Austrian Succession, 1775 American Revolutionary War, and so on.

Things to try:

- **Drag the top band of the timeline** from left to right. The world changes colour at 500, 1500 and 1900. The borders change under you, and the chronicle rolls through history.
- **Click span "1"** and drag through the 1940s. The chronicle and the map show one year at a time.
- **Zoom into Europe** and watch smaller events appear while the big ones stay where they are.
- **Click a bubble** to read about it. Then drag time far away and watch it close by itself.
- **Press ▶** with auto-explore (◎) on. Time moves at 10 years per second, and each new top event opens while the camera glides to it. Turn ◎ off and only time moves.

If something is wrong:

| You see | Cause |
|---|---|
| A black screen, "0 events" in the header | the map element has no height: see the wrapper trap in §10.1 |
| The globe, but no borders | GitHub's raw file server is blocked on your network |
| `Could not load` or `Unexpected token '<'` | `public/data/` is empty: run `npm run data` first |
| `QLever 429` | QLever is busy: wait a minute and run `npm run data` again |

---

## 12. From the mini to the full app

The mini app has the full app's skeleton. Every file here has a bigger version in this repo, and here's what the full version adds:

| The full app adds… | Where |
|---|---|
| 10 categories (epidemics, landmarks, expeditions…) and a category filter | `src/model/categories.ts`, `src/ui/CategoryMenu.tsx` |
| The first-listed location: the *order* of Wikidata statements is only available from its entity API (`wbgetclaims`), and editors list the main place first | `scripts/fetch-events.ts` |
| Borders simplified with mapshaper, with their own label points and colours made from the country's name | `scripts/fetch-geo.ts`, `src/map/borders.ts` |
| Each era as a different *kind* of map (papyrus, portolan chart, engraved atlas, satellite), with drawn textures, era fonts and fades between eras | `src/model/epochs.ts`, `src/map/style.ts`, `src/map/textures.ts` |
| Less blinking: 4 px of tolerance for events already on screen, labels that keep their side and size, exact text measurement | `src/map/placement.ts` |
| A flat map mode that handles the ±180° line | `src/map/viewport.ts` |
| A timeline with era tabs, a preview of any year's top event on hover, and dragging the chronicle | `src/timeline/timeline.ts` |
| "What happened next": a story from event to event, scored by importance, time gap and distance | `src/model/story.ts` |
| Surprise me: a time machine trip where time glides while the globe flies, landing with a ripple | `src/state/navigation.ts`, `src/map/pulse.ts` |
| Search, a first-visit tour, hover rings, shareable links | `src/ui/*`, `src/state/permalink.ts` |

Each of these is a variation on something you've already built: a fact in the pipeline, a rule in `model/`, a command in navigation, or a layer in the atlas.

That's it! You went from an empty folder to a globe of history. It downloads its own data, decides what matters in each moment, and shows only what fits.

Thank you for reading!
