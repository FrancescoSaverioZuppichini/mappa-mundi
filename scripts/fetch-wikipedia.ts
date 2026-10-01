// [Agent] Responsibility: English Wikipedia facts → data/history.sqlite: each event article's in-degree, coordinates, short description and thumbnail, cached per article.
// - in-degree: how many articles link here (CirrusSearch incoming_links), the raw material of the importance score;
// - coordinates: the article's primary {{coord}}. Many battles have one on Wikipedia but none on Wikidata, naval battles especially;
// - description and thumbnail: the one-line summary and lead image, for the panel and the dataset.
// All of it comes from one call per 50 titles (prop=cirrusdoc|coordinates|description|pageimages), instead of parsing the multi-gigabyte pagelinks and geo_tags dumps. cdincludes keeps just the one field of the search document, 24KB a batch instead of the 2.5MB full document.
import { DatabaseSync } from 'node:sqlite'
import { api, chunks, pool, storedTitles } from './wikipedia.ts'

const BATCH = 50
const WORKERS = 4

type Page = { title: string; cirrusdoc?: { source: { incoming_links?: number } }[]; coordinates?: { lat: number; lon: number }[]; description?: string; thumbnail?: { source: string } }
type Response = { query?: { normalized?: { from: string; to: string }[]; pages: Page[] } }

const db = new DatabaseSync('data/history.sqlite')
db.exec('CREATE TABLE IF NOT EXISTS articles (article TEXT PRIMARY KEY, inlinks INTEGER NOT NULL, lon REAL, lat REAL, description TEXT, thumbnail TEXT)')
if (process.argv.includes('--refresh')) db.exec('DELETE FROM articles')
const pending = (db.prepare('SELECT DISTINCT article FROM events WHERE article NOT IN (SELECT article FROM articles)').all() as { article: string }[]).map(r => r.article)
const save = db.prepare('INSERT OR REPLACE INTO articles VALUES (?, ?, ?, ?, ?, ?)')

async function fetchBatch(articles: string[]) {
  // [Agent] colimit=max matters: coordinates default to 10 per request, which silently dropped the other 40 articles' coordinates in every batch. With coprimary=primary each page has at most one, so 50 fit in one response. pilimit is the same trap for thumbnails.
  const body = await api<Response>({
    action: 'query',
    prop: 'cirrusdoc|coordinates|description|pageimages',
    cdincludes: 'incoming_links',
    coprimary: 'primary',
    colimit: 'max',
    piprop: 'thumbnail',
    pithumbsize: '640',
    pilimit: String(BATCH),
    titles: articles.join('|'),
  })
  if (!body?.query) return console.error(`✗ batch starting ${articles[0]}`)
  const stored = storedTitles(articles, body.query.normalized)
  db.exec('BEGIN')
  for (const page of body.query.pages) {
    const coord = page.coordinates?.[0]
    save.run(stored.get(page.title) ?? page.title, page.cirrusdoc?.[0]?.source.incoming_links ?? 0, coord?.lon ?? null, coord?.lat ?? null, page.description ?? null, page.thumbnail?.source ?? null)
  }
  db.exec('COMMIT')
}

console.log(`${pending.length} articles to fetch`)
await pool(chunks(pending, BATCH), WORKERS, fetchBatch, 'batches')
const { located, total } = db.prepare('SELECT count(lat) AS located, count(*) AS total FROM articles').get() as { located: number; total: number }
console.log(`✓ ${total} articles, ${located} with coordinates`)
