# Mappa Mundi

*A mappa mundi was the medieval map of the whole known world. This one also moves through time.*

**Five thousand years on one globe.** About 54,000 events from Wikipedia, from 3000 BC to today, ranked by how much the rest of Wikipedia points at them. Drag through time and the world redraws itself as the maps of each age. Zoom in and history gets denser. Press play and watch it happen.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build
npm run lint     # Biome: lint + format check (npm run format fixes)
```

Want to understand it by building it? **[TUTORIAL.md](TUTORIAL.md)** rebuilds a mini version from an empty folder, step by step: the data pipeline, ranking, level of detail, the globe and the timeline.

- [The experience](#the-experience)
- [Controls](#controls)
- [How it works](#how-it-works)
  - [The dataset](#the-dataset)
  - [Time](#time)
  - [What matters in a moment](#what-matters-in-a-moment)
  - [What the map shows: level of detail](#what-the-map-shows-level-of-detail)
  - [Eras](#eras)
  - [State: one store, one writer](#state-one-store-one-writer)
- [Architecture](#architecture)
- [Data sources](#data-sources)
- [Deploy](#deploy)
- [Dataset](#dataset)

---

## The experience

- **Every era is its own map, not a recolour.**
  - Antiquity is papyrus with brown-ink relief.
  - The Middle Ages are vellum on a lapis sea.
  - The Age of Sail is a portolan chart with rhumb lines and compass roses.
  - The Industrial Age is an engraved atlas.
  - The modern era is the satellite Earth with glowing borders.
  - Borders come from 48 historical snapshots and follow the year you're looking at. Scrubbing across 1500 re-inks the whole world.
- **Time is a place you scrub through.**
  - You look through a lens with a span in years: 1, 10, 25, 50 (the default), 100 or 500.
  - Press or drag anywhere on the bar and the lens goes there, like a video playhead. There are no handles to aim at.
  - The bar is logarithmic, so the dense recent past and the sparse deep past both get room. Era tabs jump straight to an age.
- **The chronicle names every stretch of time.**
  - Under the bar, the lens is magnified into a run of years, with the best events of the span labelled in order: 1935 Italo-Ethiopian War → 1936 Spanish Civil War → 1938 Kristallnacht → 1939 World War II → 1940 Battle of France…
  - Drag it to pan at fine scale, click a name to open it. Hovering the bar previews the headline of any year before you go there.
- **Importance is a real number.** Each event is ranked by its **in-degree**: how many English Wikipedia articles link to it. The panel prints it ("28,489 articles link here"), and the header shows the smallest in-degree currently on screen.
- **Importance belongs to its moment.** A 700-year war doesn't headline every decade it overlaps: an event's weight is spread over its years, and the span you're looking at gets the share it covers. Bubbles are sized by rank within that span, so antiquity's headliners are as big as the 20th century's.
- **Detail follows attention.**
  - A wide view shows only the headliners.
  - Zooming in or narrowing time lowers the bar, and the long tail appears.
  - The Detail slider sets how busy the screen may get.
- **Nothing flickers.** Placement is sticky, so bubbles and labels stay put while you pan and spin the globe.
- **Three ways to wander.**
  - **Surprise me** is a time machine: it jumps to an event you haven't seen, and the globe flies there and lands with a ripple.
  - **Follow the thread** chains "what happened next" from one event to the most plausible continuation, hop after hop.
  - **Play** runs history forward at the speed you choose (1 to 100 years a second). With **Auto-explore** on, each moment's most important event opens as it arrives and the camera follows it. Switch it off and only time moves.
- **Hairline craft.**
  - Smoked-glass chrome with half-pixel edges, and paper cards for content.
  - One expo ease for every motion.
  - Hover rings in a variant of each category's colour.
  - A first-visit tour, and every view is a shareable URL.
- **60 fps by construction.**
  - The map and timeline read the store directly, so no React render sits on the hot path.
  - Events are typed-array columns.
  - Every era lives in one MapLibre style, so switching eras only fades paint and never reloads.

## Controls

| Input | Does |
|---|---|
| Span 1 · 10 · 25 · 50 · 100 · 500 | how many years the lens covers |
| Press / drag on the timeline bar | move the lens there (hover previews that year's headline) |
| Drag / click the chronicle | pan at fine scale / open an event |
| Wheel on the timeline | vertical: any span in between; sideways swipe: pan |
| ← → and + − (timeline focused) | step by half a span / narrow or widen it |
| Era tabs | jump to the start of an era, keeping the span |
| ▶, − / +, compass | play through time; its speed in years per second; auto-explore on or off |
| `/` or ⌘K | search |
| `R` | Surprise me |
| Esc | close the panel, menu or tour |
| `?` button | the tour (and zoom out to the whole globe) |

The URL hash holds the view as playhead year and span, `#1942,500y` or `#1942,500y,Q362` with an event open, so any view can be bookmarked or shared. Older `#start,end` links still open.

---

## How it works

Every constant below is the one in the code, and each part names the file it describes.

### The dataset

```
Wikidata (via QLever) ──fetch-events.ts──►  data/history.sqlite  ◄──fetch-wikipedia.ts── English Wikipedia API
                                                  │   events: facts about each event   ◄──fetch-leads.ts───┘
                                                  │   articles: in-degree, coordinates, description, thumbnail
                                                  │   leads: each article's lead section
                                                  ▼
                                          export-events.ts  (every decision is made here)
                                                  ▼
                  public/data/events.arrow  ──►  the browser, and Hugging Face
                  data/release/leads.arrow  ──►  Hugging Face, and D1 (seed-db.ts) ──► /api/leads
```

The rule that keeps the pipeline simple: **the fetch scripts only record facts, and the export makes every decision.** Changing how positions are chosen or how importance is scored means re-running the export, a few seconds of work, not the network passes.

| Step | Command | What it does | Time |
|---|---|---|---|
| Wikidata facts | `npm run data:events` | classes → events, dates, position candidates (resumable; `--refresh` rebuilds) | ~10 min |
| Wikipedia facts | `npm run data:wikipedia` | in-degree, coordinates, description and thumbnail per article (cached per article) | ~15 min |
| Wikipedia leads | `npm run data:leads` | each article's lead section, cleaned to text, bold, italics and links (cached per article) | ~5 h at the API's 200 requests/min |
| Decisions | `npm run data:export` | filter, position, score, sort, write the two Feather files | ~1 min |
| Geography | `npm run data:geo` | borders, land, rivers, decorations → `public/geo` | ~20 s |
| Fonts | `npm run data:fonts` | every UI and map-label font → `public/fonts`, so nothing loads from a font CDN | seconds |

`npm run data` runs all six in order. Then `npm run data:publish` uploads the dataset to Hugging Face, and `npm run db:seed -- --remote` loads the leads into D1 (see [Dataset](#dataset) and [Deploy](#deploy)).

The two Wikipedia steps read `WIKIMEDIA_TOKEN` from `.env` if it's there: an owner-only OAuth 2 token from meta.wikimedia.org, which makes requests count against your account's rate limit instead of the anonymous one.

#### Which events

`scripts/fetch-events.ts` takes its events from **Wikidata**, queried through **QLever** (`qlever.dev`) rather than the Wikidata Query Service. WDQS times out and truncates the big classes, while QLever returns them complete in seconds.

**Allowlist, not catch-all.** The generic "occurrence" class looks tempting, but half of it is sports seasons, tennis draws, award shows and beauty pageants. Instead, `src/lib/categories.ts` lists the class trees that are actual history. Each class includes its subclasses (`wdt:P31/wdt:P279*`).

| Category | Wikidata classes |
|---|---|
| battle | battle, siege, military operation |
| war | war, armed conflict, military campaign, massacre, terrorist attack |
| politics | treaty, revolution, coup, rebellion, riot, assassination, coronation, demonstration |
| epidemic | epidemic, disease outbreak |
| disaster | disaster, natural disaster, earthquake, volcanic eruption, conflagration, shipwreck, aviation accident |
| exploration | expedition |
| culture | world's fair, Summer Olympic Games edition |
| founding | city |
| landmark | castle, cathedral, temple, palace, pyramid, monastery, mosque, fortification |
| history | historical event (catch-all, lowest priority) |

- **Ties.** An item that matches several classes keeps the **lowest category index**. The Battle of Hastings is both a battle and a "historical event", and stays a battle. Epidemic sits before disaster because Wikidata files epidemics under disasters.
- **Notability bar.** Every event must have an **English Wikipedia article**. That's also what makes in-degree measurable.

#### Dates

- **Start year:** the point in time (`P585`), else the start time (`P580`), else inception (`P571`).
- **End year:** the end time (`P582`), kept only if it's after the start, and capped at 2026.
- **Range:** only events from 3000 BC to 2026 are kept.
- **BC years:** the RDF export uses astronomical numbering, where year 0 is 1 BC and Marathon (490 BC) is `-0489`. The script shifts non-positive years down by one, so the database stores historical years and `-490` means 490 BC.

#### Where an event goes

`fetch-events.ts` records every position candidate, and `export-events.ts` picks the first that exists:

1. **The event's own coordinates** (`P625` on Wikidata). This is exact, and most battles have it.
2. **Its English Wikipedia article's `{{coord}}`**, from `fetch-wikipedia.ts`. Some battles have coordinates on Wikipedia but none on Wikidata.
3. **The median of its located sub-events**, when it has at least two. Anything that is `P361` "part of" the event, transitively, counts.
4. **Its first-listed location** (`P276`), in the order editors wrote them.
5. **Nothing.** The event is left out, because no point beats a fake one.

Why step 3 exists: a war has no single place, and its listed locations are continents and oceans. The first-listed location for WWII is *Russia*, whose coordinate is the geographic centre of Siberia. Its **1,124 located battles** have a median in Central Europe. The same rule puts the American Revolutionary War (262 sub-events) on the US east coast, where earlier heuristics had placed it in the Caribbean or Germany.

How the median is taken: coordinate by coordinate, so one stray raid can't drag a whole war. Longitudes are measured relative to the points' circular mean first, so a Pacific campaign straddling ±180° doesn't average out to Africa.

Why step 4 uses statement order: SPARQL returns locations in no particular order, but editors list the primary theatre first (the Seven Years' War starts with Europe). Only the Wikidata entity API (`wbgetclaims`) preserves that order, so the few items with several locations are asked one by one.

Seas are allowed at step 4. A naval battle "in the North Sea" belongs in the North Sea.

**Current result:** 53,868 events. By position source:

| Source | Events |
|---|---|
| Own Wikidata coordinates | 44,530 |
| First-listed location | 8,321 |
| Sub-event median | 929 |
| Wikipedia coordinates | 88 |
| Left out (no position anywhere) | 5,376 |

#### In-degree and Wikipedia coordinates

**In-degree** is the number of English Wikipedia articles that link to an event's article. `scripts/fetch-wikipedia.ts` reads it from the CirrusSearch index (`prop=cirrusdoc`, field `incoming_links`), which avoids parsing the multi-gigabyte `pagelinks` dump.

- **Batching:** one request per 50 titles fetches both in-degree and the article's primary coordinates (`prop=cirrusdoc|coordinates`).
- **`cdincludes=incoming_links`** keeps only that field, which makes a batch 24 KB instead of the 2.5 MB full search document.
- **`colimit=max`** is required. Coordinates default to 10 per request, which silently dropped the other 40 articles' coordinates in every batch.
- **Politeness:** 4 workers, and on a `429` the script waits exactly the `Retry-After` time.
- **Caching:** results go into the `articles` table, per article, so re-runs only fetch what's missing.

#### Importance score

`scripts/export-events.ts` scores every event:

```
score = min(inlinks, 60 × sitelinks^1.5) × categoryWeight
```

- **Floor:** events whose article has fewer than **10 incoming links** are dropped. About a tenth of articles have none and the bottom fifth fewer than ten. They're orphan stubs nobody links to.
- **Template cap.** CirrusSearch counts links that arrive through navbox templates. An article in a navbox transcluded on 20,000 pages gets 20,000 "links". The 2021 Austin shooting had **20,022 in-links but exists in one language**. Real prominence also shows up across languages (`sitelinks`, the number of Wikipedia editions).
  - Canonical events sit at or below about 55 × sitelinks^1.5: WWII at 44, the Bangladesh Liberation War at 53, the French Revolution at 6.
  - Template-inflated articles sit at 170–190: El Al Flight 1862, Westminster Cathedral.
  - The cap at **60×**, about the 95th percentile, flattens the spam and leaves real heavyweights untouched. WWII keeps all of its 217,991 links.
- **Category weight.** A founding or a landmark is ranked by its *place's* article, and London's links are about modern London, not its founding in 47 AD. Places are damped so they compete with events instead of drowning them. Games and fairs get the same treatment, because every Olympian's biography links their Games, so their in-links count athletes, not significance. The weights are **founding ×0.15, landmark ×0.3, culture ×0.3**, and everything else ×1.

The panel shows the **raw** in-degree ("574 articles link here"). Only ranking uses the score.

#### The shipped files

Two Feather files (Arrow IPC, ZSTD-compressed, one record batch), joined on `qid`, same rows in the same order: sorted by score, most important first. The app relies on that order everywhere: walking from the top ranks events almost without sorting (see [What matters in a moment](#what-matters-in-a-moment)).

**`public/data/events.arrow`** (1.7MB) is what the app loads, whole, at boot:

```
qid · label · article · category · start · end · lon · lat · position_source · score · inlinks · sitelinks
```

`src/hooks/useHistory.ts` reads it with [flechette](https://github.com/uwdata/flechette): `tableFromIPC` unzips each column once and hands numeric columns back as typed arrays over those bytes, so nothing is parsed. Only the strings are decoded. `category` is stored by name and mapped to `CATEGORIES` indices at load. How the zero-copy part works is in [docs/zero-copy.md](docs/zero-copy.md).

**`data/release/leads.arrow`** (not shipped) is the Wikipedia text: `qid · description · extract · lead_html · thumbnail · fetched_at`. `lead_html` keeps only `<p>`, `<b>`, `<i>` and `<a href="/wiki/…">`, so the panel can turn a link to one of our events into an in-app link. `extract` is the same text without tags. `scripts/seed-db.ts` loads it into D1, and the Worker serves one row per opened event.

#### Geography

`scripts/fetch-geo.ts` builds the map layers:

- **Borders:** 48 snapshots from [historical-basemaps](https://github.com/aourednik/historical-basemaps), simplified with mapshaper.
  - Each polity gets a colour tone from a hash of its name, so Rome keeps its colour from one snapshot to the next.
  - Labels get their own inner points, so a name isn't repeated on every tile, and larger empires win label collisions.
- **Base map:** Natural Earth 50m land, ocean, lakes and rivers.
- **Decoration:** a generated graticule, plus portolan rhumb lines. Each is a straight line in Mercator space, stepped and converted back to lon/lat.

### Time

`src/lib/time.ts` maps a year to a position `t` from 0 to 1 on the timeline. `t` is a log of "years before 2026", offset so the present doesn't stretch to infinity:

```
t(year) = (ln(5176) − ln(2026 − year + 150)) / (ln(5176) − ln(150))
```

With the offset K = 150, antiquity and the last two centuries each get about a quarter of the bar, which is roughly how the events are distributed.

- **The moment.** Where you are is the **playhead year** and a **span** in years (`state.time`). The **window** of shown events is derived from them with `windowOf`, never stored. Scrubbing, era tabs, search, Surprise and Play all move the playhead and keep the span.
- **The playhead picks the era's look and the border snapshot.** At either end of history the window is clipped rather than slid back inside, so the playhead stays exactly where it was put. Pick a 500-year span in 1942 and the window is 1692–2026, but the map still shows 1942's world. The alternative gets it wrong: sliding the window to 1526–2026 and taking its middle would put WWII bubbles on 1815 borders.
- **On the bar**, a 100-year lens is wide in the 20th century and a sliver in antiquity, so the playhead knob is what marks where you are. It sits off the lens's visual middle, because the bar is logarithmic and the lens can be clipped.
- **The chronicle** (`src/components/timeline/canvas.ts`) is the lens magnified to a linear run of years. The window's events are taken in rank order, and each claims the first of two rows where its label and its stem fit, greedily, like the map's placement. The open event goes first. A pan shifts every label by the same amount, so the same ones survive it. An event that began before the window hangs from the left edge.

### What matters in a moment

`src/lib/rank.ts` ranks the events of a time window. Ranking by full score would let a long event headline every window it touches: the Roman–Persian Wars (54 BC–628 AD) would lead every decade for seven centuries. Instead, an event's score is spread over the years it lasted, and a window gets the share it covers:

```
share      = (overlap(event, window) + 1) / (duration(event) + 1)       years, counted inclusively
importance = score × share
```

- A battle, which lasts a year, keeps its full score in any window that contains it.
- WWII (1939–1945) keeps 3/7 of its score in a 2-year window, still enough to beat the battles fought in those years.
- The Roman–Persian Wars keep 15% in a 100-year window, and all of it when the window covers the whole of antiquity. Ranking follows the scale you're looking at.

Every ranking uses this share: the map's bubbles and their sizes, the chronicle, the timeline's hover preview, Play's headline, and the panel's "top X% of this span".

`rank(events, window, hidden)` in `src/lib/rank.ts` filters the window's events and sorts them by score × share: about 0.35 ms for 15,000 events. The map, the timeline, the panel and Play all ask for the same window in the same frame, so `rank` keeps its last answer and hands it back when the question repeats. The headline of a moment is simply `rank(…)[0]`.

### What the map shows: level of detail

Each placement pass decides which events get a bubble, and which bubbles get a label. It's `placeEvents` in `src/components/globe/placement.ts`, a pure function. It sees the screen only through a `Viewport` (size, zoom, and "where does this lon/lat land, if visible"), so it knows nothing about MapLibre.

1. **Target.** The Detail slider `d ∈ [0, 1]` sets how many events the screen should hold: `target = 25 × 24^d`, from 25 to 600.
2. **Pool.** The window's events arrive ranked by `rank`, and only the top part of them compete: `pool = max(⌈population × min(1, 0.3 × 2^(zoom − 1.8))⌉, 3 × target)`.
   - At the default zoom that's the top 30%, and each zoom level doubles it. Zooming in lowers the bar, so the long tail appears only when the view gets specific.
   - The `3 × target` floor means sparse eras (antiquity) show what they have instead of being starved.
3. **Visibility.** On the globe, an event is on the visible face when it's within about 72° of the centre (the unit-vector dot product is above 0.3). Otherwise `project()` would return positions for the far side too. On the flat map, longitudes are moved to the copy of the world nearest the centre first.
4. **Order.**
   - **Pinned** events come first: the open event and a trip's destination.
   - Then **incumbents**, the events already on screen from the previous pass.
   - Then **newcomers**. Each group is in rank order.

   Incumbents keep their spot until they leave the view, so a pan can't make events flicker.
5. **Fit.** A bubble is kept only if its box doesn't overlap anything placed before it. Collision tests are exact rectangles in a 64 px spatial hash, with no grid snapping, so a pure pan can't change who collides with whom.
   - Incumbents get **4 px of slack**: they need to fit a slightly smaller box to stay than a newcomer needs to enter.
   - The first **32** placed also get a two-line label (name and date) if it fits. The label tries the side facing the screen centre first, and incumbents keep their side.
6. **Size.** The bubble radius is `3 + 7 × p³`, where `p` is the event's **percentile within the time window**. Antiquity's headliners are as big as the 20th century's, even though modern events collect 10–100× more links.
7. **Type.** The first 5 labels are 14 px, the next 13 are 12.5 px, and the rest 11 px. Every view gets its own headlines, and the sizes are sticky while an event stays on screen.

The header's "≥ N links" is the smallest raw in-degree among the events currently shown.

### Eras

The eras are defined in `src/lib/epochs.ts` and drawn by `src/components/globe/style.ts`. There are five, each a different kind of map rather than a recolour:

| Era | From | Look |
|---|---|---|
| Antiquity | 3000 BC | papyrus, brown-ink relief, coastal ripples, Cinzel |
| Middle Ages | 500 | vellum land, lapis sea with wave marks, gold-edged borders, Almendra |
| Age of Sail | 1500 | portolan chart: rhumb lines, compass roses, graticule, IM Fell English |
| Industrial Age | 1800 | engraved atlas: ruled sea, graticule, Playfair Display |
| Modern | 1945 | NASA Blue Marble satellite, glowing borders, Inter |

How switching works:

- Every era's layers live in **one** MapLibre style. Switching eras fades opacities and swaps paint in place, and never reloads the style.
- Textures are painted procedurally the first time an era needs them, so there's nothing to download.
- Map labels are rendered by MapLibre from each era's own font files.
- Borders show the latest snapshot at or before the playhead year, debounced by 120 ms while scrubbing.

### State: one store, one writer

The whole app runs on one zustand store in `src/hooks/useHistory.ts`: the state, plus `update`, the only way to change it. Components read a slice and take `update` from the same hook. There's no main loop: nothing runs while you're idle.

```ts
state = {
  time:     { year, span },                 // where you are; the window of shown events is derived (windowOf)
  selected: number | null,                  // the open event
  view:     { detail, hidden, projection }, // what you see
  play:     { on, speed, explore },         // time moving by itself
  thread:   boolean,                        // hopping along "what happened next"
  tour:     boolean,
  drawn:    { … },                          // what the globe drew, for the header's counts
}

const time = useHistory(s => s.time)       // a component re-renders only when its slice changes
const update = useHistory(s => s.update)
update({ time: { span: 25 } })             // a patch names only what changes; a group is replaced only if touched,
update({ selected: i })                    // so a component reading `time` doesn't re-render when `view` changes
```

**Every rule lives in one pure function, `apply(prev, patch)` in `src/lib/history.ts`,** and the store's `update` is just `set(prev => apply(events, prev, patch))`:

- Opening an event takes you to its time.
- Moving time off the open event closes it, so a 2011 war never lingers over antiquity.
- Picking an event stops Play and the thread, unless the patch keeps them on (their own loops do).
- Play starts from the moment itself, not from whatever was open.

**What reads it:**

| Who | Reads | Writes |
|---|---|---|
| Header | `time`, `view`, `drawn` | `update({ time: { span } })`, `update({ view: { detail } })` |
| Timeline | `time`, `rank(…)` for the chronicle | `update({ time: { year } })`, `update({ selected })` |
| Globe (`components/globe/map.ts`) | `time`, `view`, `selected`, `rank(…)` | `update({ selected })` on click, `update({ drawn })` after drawing |
| Panel, Search, Surprise, Categories, Tour | their slices | `update({ selected })`, `update({ thread })`, `update({ view: { hidden } })` … |

**The camera isn't state.** The globe follows `selected`:

- a newly opened event already in view beside the panel only eases the padding;
- otherwise the camera flies a high arc (`curve 1.7`, 2.2 s) down to regional zoom 4, and a ripple in a variant of the event's colour marks the landing;
- during Play it glides instead (2.4 s, never zooming out).

**What runs by itself** is three reactions in `hooks/useHistory.ts`, each writing back through `update()`. They, the map and the timeline canvas are the only code that uses `useHistory.getState()` and `subscribe()`, because they aren't React components:

- **Play.** Each frame moves the playhead `speed` years per second (1, 2, 5, 10, 25, 50, 100; default 10), measured in real time. With explore on, when the window's top event changes, it opens, at most every 3.5 s so each one stays up long enough to read. It stops at 2026 or when you pick an event.
- **The thread.** It lingers 10 s on the open event, then opens `nextInStory`, never revisiting an event. It ends when the story runs out or you pick something.
- **The URL.** `#year,spany[,Qid]` is written at most every 250 ms, and read once at startup. Older `#start,end` links still open.

Surprise me (the **R** key) opens a random event from the 6,000 most linked, and doesn't repeat one until it has shown them all.

#### What happened next

`nextInStory(from)` in `src/lib/story.ts` picks the event that best continues the story:

```
horizon = max(4, (2026 − start(from)) × 0.04)            years
gap     = start(j) − start(from)                          must be > 0 and ≤ 4 × horizon
km      = distance(from, j)                               must be ≤ 3,000
weight  = score(j) / (1 + gap / horizon) / (1 + km / 800) × (1.3 if same category)
```

The highest weight wins. Important, soon after and nearby all push the weight up, and a shared category (war → battle, treaty → treaty) nudges it further.

The **horizon scales with age**, because the record thins out the further back you go. Around 1940 it's a few years, in the Middle Ages decades, and in antiquity a couple of centuries.

A real thread from the current data: **Battle of Cape Esperance** (1942, Solomon Islands) → **Bougainville Campaign** (1943, 605 km away) → **Mariana and Palau Islands campaign** (1944).

#### The event panel's other lists

`src/components/EventPanel.tsx` builds each list by walking the score-sorted events once and keeping the first 5 matches, so they're already the most important ones.

- **Meanwhile, elsewhere:** events overlapping the same years, more than 800 km away. "The same years" widens with age by `max(2, (2026 − start) × 0.01)` years: ±2 for the 1940s, ±10 around 1066, ±25 in antiquity.
- **Same place, other eras:** events within 150 km, from any time, listed chronologically.
- **Top X% of this span:** the event's rank in the current window by share. It's hidden when the event is outside the window, as when Play has moved on past it.

---

## Architecture

Three parts: an offline **data pipeline** (`scripts/`), the **app** (`src/`), and one small **Worker** (`worker/`) for the only thing static files can't do.

```
scripts/  Node, offline         ──►  public/data/events.arrow, public/geo/*  ──►  src/  browser
          Wikidata · Wikipedia       data/release/leads.arrow ──► D1          ──►  worker/  /api/leads/:qid
          → data/history.sqlite      both .arrow files ──► Hugging Face             MapLibre · React
```

### Every file and what it's responsible for

Each file opens with the same line (`// [Agent] Responsibility: …`), and this tree is those lines, shortened.

```
scripts/                       the offline pipeline (Node 24)
├─ fetch-events.ts             Wikidata facts → data/history.sqlite: dates, sitelinks, position candidates. Decides nothing.
├─ fetch-wikipedia.ts          Wikipedia facts → data/history.sqlite: each article's in-degree, coordinates, description and thumbnail
├─ fetch-leads.ts              Wikipedia leads → data/history.sqlite: each article's lead section, cleaned, cached per article
├─ wikipedia.ts                talking to the Wikipedia API: one polite request, a worker pool, title mapping
├─ export-events.ts            every decision: facts → events.arrow + leads.arrow (what ships, where, how important)
├─ publish-dataset.ts          the dataset → Hugging Face, one commit
├─ seed-db.ts                  leads.arrow → D1, through one SQL file wrangler runs
├─ consts.ts                   what the scripts must agree on: User-Agent, the in-link floor, file paths, the ZSTD codec
├─ fetch-geo.ts                geography → public/geo: land, sea, lakes, rivers, border snapshots, decoration
└─ fetch-fonts.ts              every font, once → public/fonts (UI woff2 + ui.css, map-label TTFs), so no font CDN at runtime

worker/
└─ index.ts                    GET /api/leads/:qid → one row from D1, edge-cached

src/
├─ main.tsx                    boot: fonts + the app together, or an error on the page if the data fails
├─ index.css                   Tailwind, the theme tokens the epochs rewrite, custom utilities and keyframes
├─ types.ts                    the shared shapes: EventsData, HistoryState, HistoryPatch, HistoryStore, EpochConfig, …
├─ consts.ts                   the numbers that define behaviour, and the default state
├─ hooks/
│   └─ useHistory.ts           the store: loads the data, the one state + update(), and Play, the thread and the URL
├─ lib/                        pure functions over plain data: no React, no DOM, no MapLibre
│   ├─ history.ts              every rule of the state: apply(prev, patch) → next
│   ├─ rank.ts                 what matters in a moment: rank(events, window, hidden), by score × share
│   ├─ story.ts                "what happened next", and distances between events
│   ├─ time.ts                 the log scale of the bar, windowOf, year formatting
│   ├─ categories.ts           categories: Wikidata classes, colour, rank weight (shared with scripts/)
│   └─ epochs.ts               the five eras: start year, UI palette and fonts, map look; epochAt(year)
└─ components/                 React, plus the two imperative engines
    ├─ App.tsx                 the page: layer order, and the epoch's colours as CSS variables
    ├─ Header.tsx              era and years, span buttons, Detail and counts, the toolbar
    ├─ Search.tsx              find an event by name and open it (/ or ⌘K)
    ├─ CategoryMenu.tsx        switch categories on and off, with counts for the window
    ├─ EventPanel.tsx          the open event: lead, rank in the span, related events, what happened next, the thread
    ├─ Surprise.tsx            open a random notable event not seen yet (button or R)
    ├─ Tour.tsx                the first-visit tour: steps that spotlight the real UI and act out what they say
    ├─ icons.tsx               the line icons
    ├─ globe/
    │   ├─ Globe.tsx           mounts map.ts; owns the hover state that feeds the Tooltip
    │   ├─ map.ts              THE GLOBE ENGINE: owns the MapLibre map, draws the state, re-places on camera moves, follows `selected`
    │   ├─ placement.ts        level of detail, pure: which events get a bubble and a label, and how big
    │   ├─ viewport.ts         the map's view as a Viewport: size, zoom, lon/lat → screen (null when hidden)
    │   ├─ style.ts            the MapLibre style for every era; switching eras by fading paint
    │   ├─ borders.ts          the border snapshot at or before the playhead
    │   ├─ hover.ts            the bubble under the pointer, and its eased ring
    │   ├─ pulse.ts            the ripple when the camera lands
    │   ├─ textures.ts         procedural era textures (papyrus, vellum, grain, waves, engraving)
    │   └─ Tooltip.tsx         the card that follows the pointer over a bubble
    └─ timeline/
        ├─ Timeline.tsx        the bottom bar: Play, explore, speed, and the canvas
        └─ canvas.ts           THE TIMELINE ENGINE: owns the <canvas>, draws tabs, overview, lens and chronicle; input → update()
```

**`map.ts` vs `canvas.ts`.** They're the app's two engines: imperative code that owns one element each, reads the store and writes through `update()`, and never renders React. `map.ts` owns the MapLibre globe: bubbles, labels, borders, the era's look and the camera. `canvas.ts` owns the timeline bar: the histogram, the lens, the playhead and the chronicle, and it turns pointer, wheel and keys into time and selection changes. They share nothing but the store.

**Dependency rule.** Components read and write through `hooks/useHistory.ts`, which uses `lib/`. `lib/` imports nothing from the app. Inside `components/globe/`, only `map.ts` touches the state; the other modules take plain inputs and return plain outputs.

**Data flow.** One state, one writer, and everything reacts (see [State: one store, one writer](#state-one-store-one-writer)). The events are loaded once as typed-array columns, sorted by importance, and every module reads them by row index. There are no per-event objects.

**Conventions.**

- Imperative modules are functions: `createMap`, `createTimeline`, `createBorders` and `createHover` each take their inputs and return a cleanup, or an object with `destroy`. There are no classes and no framework glue.
- Pure logic is plain functions over plain data: `rank`, `placeEvents`, `nextInStory`, `windowOf`, `formatYears`.
- No `utils` module. A helper lives next to its only caller unless two layers genuinely share it.
- Comments marked `[Agent]` explain *why*, not what.

## Data sources

Everything the app shows comes from somewhere else. There are two kinds of use: **fetched once** by the pipeline (`scripts/`), with the results committed in `public/` or loaded into D1, and **fetched live** by the browser on every visit.

### Fetched once, by the pipeline

| Source | What we use it for | How | License |
|---|---|---|---|
| [Wikidata](https://www.wikidata.org) | the events: classes, dates, coordinates, locations, "part of" links, sitelink counts | SPARQL through the public [QLever](https://qlever.dev) endpoint (`fetch-events.ts`), plus the entity API `wbgetclaims` for the order of listed locations | CC0 |
| [English Wikipedia](https://en.wikipedia.org) | each article's in-degree (incoming links), `{{coord}}` coordinates, short description and lead image | Action API, `prop=cirrusdoc\|coordinates\|description\|pageimages`, 50 titles a call (`fetch-wikipedia.ts`) | the numbers are facts; descriptions are CC BY-SA 4.0 |
| [English Wikipedia](https://en.wikipedia.org) | each article's lead section, with its links | Action API, `action=parse`, section 0, one call per article (`fetch-leads.ts`) | CC BY-SA 4.0, credited and linked back through "Read on Wikipedia". Only text, bold, italics and links are kept |
| [historical-basemaps](https://github.com/aourednik/historical-basemaps) by André Ourednik | the 48 historical border snapshots | raw GeoJSON from GitHub, simplified with mapshaper (`fetch-geo.ts`) → `public/geo/borders/` | GPL-3.0: the processed files in `public/geo/borders/` are a derivative and stay under it |
| [Natural Earth](https://www.naturalearthdata.com) 1:50m | land, ocean, lakes and rivers | GeoJSON from [natural-earth-vector](https://github.com/nvkelso/natural-earth-vector) (`fetch-geo.ts`) → `public/geo/` | public domain |
| Fonts via [fontsource](https://fontsource.org): Inter, Source Serif 4, Cinzel, Almendra, IM Fell English, Playfair Display, Noto Serif | all UI and map-label typography | woff2 and TTF from fontsource's CDN (`fetch-fonts.ts`) → `public/fonts/` | SIL Open Font License 1.1; each family's license ships in `public/fonts/licenses/` |

The graticule and portolan rhumb lines in `public/geo/` are generated by `fetch-geo.ts`, and the era textures by `components/globe/textures.ts`. Neither has an outside source.

### Fetched live, by the browser

| Source | What for | License / credit |
|---|---|---|
| our Worker, `/api/leads/:qid` (D1) | the event panel's text, with its links: a link to one of our events opens it in the app, any other opens Wikipedia | the Wikipedia leads from the pipeline, CC BY-SA 4.0. Rebuilt as React elements, never injected as HTML |
| [Wikimedia Commons](https://commons.wikimedia.org) | the panel's thumbnail, loaded straight from Wikimedia's CDN | each image under its own license (see the image's Commons page) |
| [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen Terrarium, AWS Open Data) | the hillshaded relief of the older eras | free with attribution; credited on the map as "Terrain: Mapzen / AWS" |
| [NASA GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api) Blue Marble Shaded Relief & Bathymetry | the modern era's satellite imagery | NASA imagery, no copyright; credited on the map as "NASA Blue Marble" |
| [MapLibre demo glyphs](https://demotiles.maplibre.org) | fallback only: map characters outside the bundled latin fonts | free to use |

The map's attribution control (bottom right) credits Natural Earth, historical-basemaps, Wikidata and Wikipedia, the terrain tiles and NASA while each is on screen.

## Deploy

Static files plus one Worker, on Cloudflare (`wrangler.jsonc`). `npm run build` writes `dist/` with the [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/): the site, and the Worker beside it. Everything the site needs is committed in `public/`, so the host never runs the data pipeline. Static files never run the Worker; only `/api/*` does (`run_worker_first`).

Connect the repo under Workers & Pages → Create → Import a repository, and keep the defaults: build command `npm run build`, deploy command `npx wrangler deploy`. Every push to `main` deploys.

**D1.** The leads live in a D1 database, `mappa-mundi`, bound as `DB`. Create it once with `npx wrangler d1 create mappa-mundi` and put its id in `wrangler.jsonc`. Then `npm run db:seed -- --remote` fills it from `data/release/leads.arrow`, and re-running it after an export rebuilds the table. `npm run db:seed` without the flag fills the local D1 that `npm run dev` uses.

Node comes from `.node-version` (24), and `public/_headers` sets the caching: fingerprinted `/assets` forever, fonts for a year, data and geography for a day. State lives in the URL hash, so there are no routes to rewrite.

## Dataset

The data is published on Hugging Face as **[Francesco/mappa-mundi](https://huggingface.co/datasets/Francesco/mappa-mundi)**: `events.arrow` (the same file the app ships) and `leads.arrow`, with a dataset card describing every column. `npm run data:publish` uploads both in one commit; `npm run data:publish -- README.md` uploads just the named files. It reads `HF_TOKEN` from `.env`.

```python
import pandas as pd
events = pd.read_feather("hf://datasets/Francesco/mappa-mundi/events.arrow")
```
