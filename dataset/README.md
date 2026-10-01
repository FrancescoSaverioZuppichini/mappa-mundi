---
license: cc-by-sa-4.0
pretty_name: Mappa Mundi
language:
  - en
size_categories:
  - 10K<n<100K
tags:
  - history
  - geospatial
  - wikidata
  - wikipedia
  - events
  - timeline
configs:
  - config_name: events
    data_files: events.arrow
    default: true
  - config_name: leads
    data_files: leads.arrow
---

# Mappa Mundi

53,868 historical events from 3000 BC to today, each placed on the globe and ranked by how much the rest of Wikipedia points at it. The top of the list is World War II, World War I, the COVID-19 pandemic and the American Civil War. It's the data behind Mappa Mundi, an atlas of history you drag through time.

Two tables, same rows in the same order, joined on `qid`:

| file | what | rows |
|---|---|---|
| `events.arrow` | the facts: when, where, what kind, how important | 53,868 |
| `leads.arrow` | the English Wikipedia text: lead, description, thumbnail | 53,868 |

Both are **Feather v2 (Arrow IPC file), ZSTD-compressed, one record batch**, which pandas, polars and pyarrow read natively. After the unzip, numeric columns load with no parsing: a reader maps them straight onto the bytes.

## events.arrow

Rows are sorted by `score`, most important first.

| column | type | |
|---|---|---|
| `qid` | string | Wikidata id, e.g. `Q362` |
| `label` | string | English label |
| `article` | string | English Wikipedia title, e.g. `World_War_II` |
| `category` | dictionary&lt;string&gt; | `battle`, `war`, `politics`, `epidemic`, `disaster`, `exploration`, `culture`, `founding`, `landmark`, `history` |
| `start`, `end` | float32 | historical years, negative = BC (no year 0). `end` = `start` for a point in time |
| `lon`, `lat` | float32 | where it happened, WGS84 degrees |
| `position_source` | dictionary&lt;string&gt; | which rule placed it, see below |
| `score` | float32 | importance, see below |
| `inlinks` | float32 | English Wikipedia articles linking to it |
| `sitelinks` | float32 | Wikipedia language editions with an article on it |

**Position**, first match wins (`position_source`):
1. `wikidata`: the event's own Wikidata coordinates.
2. `wikipedia`: its English article's `{{coord}}`. Many battles have one even when Wikidata doesn't, naval battles especially.
3. `sub-events`: the median of its located sub-events, when it has at least two. A war is where its battles were.
4. `location`: its first-listed Wikidata location. For a naval battle that is often a sea, which is the right answer.

Events none of these can place are left out, and so are articles with fewer than 10 in-links.

**Score** = robust in-degree × category weight.
- In-degree counts incoming links (CirrusSearch `incoming_links`). It's capped at 60 × sitelinks^1.5, because links arriving through navbox templates inflate some articles 20,000×, and real prominence also shows up across languages.
- The category weight damps places (`founding` 0.15, `landmark` and `culture` 0.3), whose links measure the modern city rather than its founding.

## leads.arrow

| column | type | |
|---|---|---|
| `qid` | string | joins `events.arrow` |
| `description` | string? | Wikipedia's one-line short description |
| `extract` | string? | the lead section as plain text, paragraphs separated by blank lines |
| `lead_html` | string? | the same lead as minimal HTML: `<p>`, `<b>`, `<i>` and `<a href="/wiki/…">` only, footnotes and coordinates stripped |
| `thumbnail` | string? | URL of the article's lead image on Wikimedia, 640px |
| `fetched_at` | string? | when the lead was fetched (UTC) |

Null means Wikipedia had nothing for that field.

## Load it

```python
import pandas as pd
events = pd.read_feather("hf://datasets/Francesco/mappa-mundi/events.arrow")
leads = pd.read_feather("hf://datasets/Francesco/mappa-mundi/leads.arrow")
```

```python
import polars as pl
events = pl.read_ipc("hf://datasets/Francesco/mappa-mundi/events.arrow")
```

```python
from datasets import load_dataset
events = load_dataset("Francesco/mappa-mundi", "events", split="train")
```

```js
import { tableFromIPC } from '@uwdata/flechette'
const url = 'https://huggingface.co/datasets/Francesco/mappa-mundi/resolve/main/events.arrow'
const events = tableFromIPC(await (await fetch(url)).arrayBuffer())
events.getChild('lon').toArray() // a Float32Array over the downloaded bytes, no copy
```

## Sources and license

- **[Wikidata](https://www.wikidata.org)** (CC0): the events, their classes, dates, coordinates, locations and sitelinks, queried through [QLever](https://qlever.dev).
- **[English Wikipedia](https://en.wikipedia.org)**: in-links, coordinates, descriptions and leads, through the Action API. The text in `leads.arrow` is CC BY-SA 4.0, so the dataset as a whole is CC BY-SA 4.0: credit Wikipedia and share alike.
- Thumbnails are links to Wikimedia Commons, not copies. Each image keeps its own license, shown on its Commons page.
