# WikiHistory

**Five thousand years on one globe.** About 54,000 events from Wikipedia, from 3000 BC to today, ranked by how much the rest of Wikipedia points at them. Drag through time and the world redraws itself as the maps of each age. Zoom in and history gets denser. Press play and watch it happen.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build
npm run lint
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
  - [Navigation](#navigation)
- [Architecture](#architecture)
- [Sources](#sources)

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
  - You look through a lens with a span in years: 1, 10, 25, 50, 100 (the default) or 500.
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
  - **Surprise me** is a time machine. The years glide across the bar while the globe flies to an event you haven't seen, landing with a ripple.
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
                                                  │   events: facts about each event
                                                  │   articles: in-degree + coordinates per article
                                                  ▼
                                          export-events.ts  (every decision is made here)
                                                  ▼
                              public/data/events.bin + events-meta.json   →  the browser
```

The rule that keeps the pipeline simple: **the fetch scripts only record facts, and the export makes every decision.** Changing how positions are chosen or how importance is scored means re-running the export, a few seconds of work, not the network passes.

| Step | Command | What it does | Time |
|---|---|---|---|
| Wikidata facts | `npm run data:events` | classes → events, dates, position candidates (resumable; `--refresh` rebuilds) | ~10 min |
| Wikipedia facts | `npm run data:wikipedia` | in-degree + article coordinates per article (cached per article) | ~15 min |
| Decisions | `npm run data:export` | filter, position, score, sort, write binary | seconds |
| Geography | `npm run data:geo` | borders, land, rivers, decorations → `public/geo` | ~20 s |

`npm run data` runs all four in order.

#### Which events

`scripts/fetch-events.ts` takes its events from **Wikidata**, queried through **QLever** (`qlever.dev`) rather than the Wikidata Query Service. WDQS times out and truncates the big classes, while QLever returns them complete in seconds.

**Allowlist, not catch-all.** The generic "occurrence" class looks tempting, but half of it is sports seasons, tennis draws, award shows and beauty pageants. Instead, `src/model/categories.ts` lists the class trees that are actual history. Each class includes its subclasses (`wdt:P31/wdt:P279*`).

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

Rows are sorted by score, most important first. The app relies on that order everywhere: walking from the top ranks events almost without sorting (see [What matters in a moment](#what-matters-in-a-moment)).

`events.bin` is binary. Every `f32` column starts 4-byte aligned, so `src/model/events.ts` wraps each one as a typed-array view with no copy.

```
u32 count
f32 [lon, lat] × count
f32 start      × count
f32 end        × count
f32 score      × count
f32 inlinks    × count
f32 sitelinks  × count
u8  category   × count
```

`events-meta.json` holds the strings: `{ qid[], label[], article[] }`. An article title equal to the label (with underscores) ships as `""`, which makes the file about a third smaller.

#### Geography

`scripts/fetch-geo.ts` builds the map layers:

- **Borders:** 48 snapshots from [historical-basemaps](https://github.com/aourednik/historical-basemaps), simplified with mapshaper.
  - Each polity gets a colour tone from a hash of its name, so Rome keeps its colour from one snapshot to the next.
  - Labels get their own inner points, so a name isn't repeated on every tile, and larger empires win label collisions.
- **Base map:** Natural Earth 50m land, ocean, lakes and rivers.
- **Decoration:** a generated graticule, plus portolan rhumb lines. Each is a straight line in Mercator space, stepped and converted back to lon/lat.

### Time

`src/model/time.ts` maps a year to a position `t` from 0 to 1 on the timeline. `t` is a log of "years before 2026", offset so the present doesn't stretch to infinity:

```
t(year) = (ln(5176) − ln(2026 − year + 150)) / (ln(5176) − ln(150))
```

With the offset K = 150, antiquity and the last two centuries each get about a quarter of the bar, which is roughly how the events are distributed.

- **The moment.** Where you are is a `Moment`: the **playhead year**, a **span** in years, and the **window** of events they cover. Every move builds one with `momentAt(year, span)`, so the three never disagree. Scrubbing, era tabs, search, trips and Play all move the playhead and keep the span.
- **The playhead picks the era's look and the border snapshot.** At either end of history the window is clipped rather than slid back inside, so the playhead stays exactly where it was put. Pick a 500-year span in 1942 and the window is 1692–2026, but the map still shows 1942's world. The alternative gets it wrong: sliding the window to 1526–2026 and taking its middle would put WWII bubbles on 1815 borders.
- **On the bar**, a 100-year lens is wide in the 20th century and a sliver in antiquity, so the playhead knob is what marks where you are. It sits off the lens's visual middle, because the bar is logarithmic and the lens can be clipped.
- **The chronicle** (`src/timeline/timeline.ts`) is the lens magnified to a linear run of years. The window's events are taken in rank order, and each claims the first of two rows where its label and its stem fit, greedily, like the map's placement. The open event goes first. A pan shifts every label by the same amount, so the same ones survive it. An event that began before the window hangs from the left edge.

### What matters in a moment

`src/model/rank.ts` ranks the events of a time window. Ranking by full score would let a long event headline every window it touches: the Roman–Persian Wars (54 BC–628 AD) would lead every decade for seven centuries. Instead, an event's score is spread over the years it lasted, and a window gets the share it covers:

```
share      = (overlap(event, window) + 1) / (duration(event) + 1)       years, counted inclusively
importance = score × share
```

- A battle, which lasts a year, keeps its full score in any window that contains it.
- WWII (1939–1945) keeps 3/7 of its score in a 2-year window, still enough to beat the battles fought in those years.
- The Roman–Persian Wars keep 15% in a 100-year window, and all of it when the window covers the whole of antiquity. Ranking follows the scale you're looking at.

Every ranking uses this share: the map's bubbles and their sizes, the chronicle, the timeline's hover preview, Play's headline, and the panel's "top X% of this span".

Computing it stays cheap because the rows are pre-sorted by full score and a share is at most 1:

- **`rankWindow`.** Events wholly inside the window keep their full score, so they're already in order. Only the ones sticking out past an edge get sorted, and then the two runs are merged. The atlas caches the result per window, so a pan or zoom doesn't recompute it.
- **`headlineOf`** is the top event alone. It walks from the top row and stops once a row's full score can't beat the best share found so far.

### What the map shows: level of detail

Each placement pass decides which events get a bubble, and which bubbles get a label. It's `placeEvents` in `src/map/placement.ts`, a pure function. It sees the screen only through a `Viewport` (size, zoom, and "where does this lon/lat land, if visible"), so it knows nothing about MapLibre.

1. **Target.** The Detail slider `d ∈ [0, 1]` sets how many events the screen should hold: `target = 25 × 24^d`, from 25 to 600.
2. **Pool.** The window's events arrive ranked by `rankWindow`, and only the top part of them compete: `pool = max(⌈population × min(1, 0.3 × 2^(zoom − 1.8))⌉, 3 × target)`.
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

The eras are defined in `src/model/epochs.ts` and drawn by `src/map/style.ts`. There are five, each a different kind of map rather than a recolour:

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

### Navigation

Every way the view moves between events goes through one module, `src/state/navigation.ts`. It owns the selection, the time-window animations and the camera. The camera is an explicit command in the store, `camera: { index, mode }`, which `src/map/atlas.ts` executes. The map never infers camera moves from other state.

**Every user action interrupts** the two autoplays (the story thread and Play) and cancels any trip in flight, so nothing else needs to know they exist.

**The open event always lies inside the time window**, except during a trip. `keepSelectionInTime` watches the window, and moving time off the open event closes it, whether by scrubbing, a span button, an era tab or Play running past it. So a 2011 war never lingers over antiquity.

#### The moves

| Move | Triggered by | What happens |
|---|---|---|
| `select(i)` | clicking a bubble, closing the panel | Opens or closes in place. No camera move. |
| `focus(i)` | search, related lists, shared links, chronicle labels | The window keeps its span and re-centres on the event (unless it's already inside). Camera `reveal`: fly there only if it isn't visible beside the panel. |
| `travelTo(i)` | "What happened next" | The time machine trip, described below. |
| `surprise()` | "Surprise me", the **R** key | `travelTo` a random event from the top 6,000 not yet seen this session: famous enough to have a story, not always the same ten headliners. |
| `follow()` | "Follow the thread" | Autoplays "what happened next": travel, dwell 10 s, travel again, never revisiting an event. Stops when the story runs out or you take over. "Next now" skips the dwell. |
| `play()` | the timeline's ▶ | Time runs forward at the chosen speed. With auto-explore on, each moment's headline opens as the camera glides to it. See below. |

**The trip** (`travelTo`, used by surprise and follow):

- **Time.** Over 2.4 s on an in-out cubic curve, the window glides to the event, keeping its span. The glide runs in bar position rather than years, so a trip from 1900 to 500 BC spends its time evenly across the ages. The map re-inks itself through every era it passes.
- **Space.** At the same time, camera `travel` flies a high arc (`curve 1.7`, 2.2 s) down to regional zoom **4.4**, already padded for the panel.
- **Pinned.** During the flight the destination is `flight` in the store, which placement pins so the event is drawn the moment the camera lands.
- **Arrival.** A ripple in a variant of the event's colour grows out and fades (1.4 s), then the event becomes the selection and the panel opens.

**Play:**

- **Speed.** The window slides forward in real years: `playSpeed` years per second, stepped with − / + through **1, 2, 5, 10, 25, 50, 100** (default 10). "1 yr/s" means exactly that.
- **Live settings.** Speed, span and auto-explore can all change mid-play, and dragging the timeline just moves where playback continues from, because every frame starts from the current store state.
- **Headline.** The headline of a moment is the most important event of the current window by share (`headlineOf`, see [What matters in a moment](#what-matters-in-a-moment)).
- **Auto-explore** (the compass beside ▶, on by default). When the headline changes, it opens in the panel and camera `glide` eases the map to it (2.4 s, zoom ≥ 2.5, never zooming out if you're already closer). A new headline opens **at most every 3.5 s**, so each one stays up long enough to read and the camera drifts instead of twitching. With auto-explore off, Play only moves time.
- **Starting** clears the open event, so Play begins from the moment itself rather than from whatever was being read.
- **Stopping.** Playback stops at 2026, or when any user action takes over. Play writes its own selections straight to the store rather than through `select()`, which would interrupt it.

#### What happened next

`nextInStory(from)` in `src/model/story.ts` picks the event that best continues the story:

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

`src/ui/EventPanel.tsx` builds each list by walking the score-sorted events once and keeping the first 5 matches, so they're already the most important ones.

- **Meanwhile, elsewhere:** events overlapping the same years, more than 800 km away. "The same years" widens with age by `max(2, (2026 − start) × 0.01)` years: ±2 for the 1940s, ±10 around 1066, ±25 in antiquity.
- **Same place, other eras:** events within 150 km, from any time, listed chronologically.
- **Top X% of this span:** the event's rank in the current window by share. It's hidden when the event is outside the window, as when Play has moved on past it.

---

## Architecture

Two halves that meet at two files in `public/`: an offline **data pipeline** (`scripts/`) and the **app** (`src/`).

```
scripts/  Node, offline         ──►  public/data/events.bin + events-meta.json   ──►  src/  browser
          Wikidata · Wikipedia       public/geo/*                                      MapLibre · React
          → data/history.sqlite
```

### App layers

```
src/
├─ main.tsx         boot: load data and fonts → restore URL → render
├─ model/           what the app is about. Pure data and rules; no DOM, state, React or MapLibre
│   ├─ categories.ts   event categories: Wikidata classes, colour, rank weight (shared with scripts/)
│   ├─ rank.ts         what matters in a moment: events ranked by their share of a window, and its headline
│   ├─ story.ts        which event comes next in a story
│   ├─ epochs.ts       the five eras and each one's map look
│   ├─ events.ts       the EventsData columns + loading them
│   └─ time.ts         the log time scale (year ⇄ position on the bar), the moment (playhead, span, window), year formatting
├─ state/           the single store and what changes it
│   ├─ store.ts        app state: the moment, selection, filters, camera command, autoplay flags, play speed
│   ├─ navigation.ts   every way the view moves: select, focus, travel, surprise, follow the thread, play
│   └─ permalink.ts    URL hash ⇄ state
├─ map/             the MapLibre adapter (imperative)
│   ├─ atlas.ts        composition root: creates the map, wires the pieces below to the store
│   ├─ placement.ts    level of detail, PURE: which events get a bubble and a label (sees a Viewport, not MapLibre)
│   ├─ viewport.ts     the map's view as a Viewport: what's visible, and where it lands on screen
│   ├─ style.ts        the MapLibre style, plus switching epochs by fading paint in place
│   ├─ borders.ts      historical border snapshots for the playhead year
│   ├─ hover.ts        hover state and its eased ring animation
│   ├─ pulse.ts        the one-shot arrival ripple
│   └─ textures.ts     procedural paper, vellum and engraving textures
├─ timeline/
│   └─ timeline.ts     the canvas timeline: era tabs, the overview with its lens, the chronicle; scrub, pan, wheel, keyboard
└─ ui/              React components: chrome, panels, tour
    ├─ App.tsx         page layout + epoch theme (CSS variables)
    ├─ Atlas.tsx, Timeline.tsx   mount the imperative map and timeline (Timeline also holds Play and its speed)
    └─ Header, Search, CategoryMenu, EventPanel, Tooltip, Tour, Surprise, icons
```

**Dependency rule: imports only point down.** `ui → map, timeline → state → model`. `model` imports nothing from the app, and `ui` reaches `map` and `timeline` only through the two components that mount them. Within `map`, only `atlas.ts` talks to the store; the other modules take plain inputs and return plain outputs.

**Data flow.**

- **One zustand store.** The map and the timeline subscribe to it directly, outside React, so dragging through time or panning never costs a React render. Components read it with `useStore(store, selector)` and re-render only when their slice changes.
- **Plain arrays for the events.** They're loaded once as typed-array columns (`EventsData`), sorted by importance, and every module reads them by row index. There are no per-event objects.
- **One owner for navigation.** `state/navigation.ts` owns the selection, the time-window animations and the camera command (see [Navigation](#navigation)).

**Conventions.**

- Imperative modules are functions: `createAtlas`, `createTimeline`, `createBorders` and `createHover` each take their inputs and return a cleanup, or an object with `destroy`. There are no classes and no framework glue.
- Pure logic is plain functions over plain data: `rankWindow`, `placeEvents`, `nextInStory`, `momentAt`, `formatYears`.
- No `utils` module. A helper lives next to its only caller unless two layers genuinely share it.
- Comments marked `[Agent]` explain *why*, not what.

## Sources

Wikidata (CC0), Wikipedia (CC BY-SA), [historical-basemaps](https://github.com/aourednik/historical-basemaps) (GPL-3.0), Natural Earth (public domain), Mapzen terrain tiles, NASA Blue Marble.
