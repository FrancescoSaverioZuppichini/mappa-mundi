// [Agent] English Wikipedia facts per event article, cached in the `articles` table so only articles not fetched yet are asked for. Pass --refresh to refetch everything.
// - in-degree: how many articles link here (CirrusSearch incoming_links), the raw material of the importance score;
// - coordinates: the article's primary {{coord}}. Many battles have one on Wikipedia but none on Wikidata, naval battles especially.
// Both come from one call per 50 titles (prop=cirrusdoc|coordinates), instead of parsing the multi-gigabyte pagelinks and geo_tags dumps. cdincludes keeps just the one field of the search document, 24KB a batch instead of the 2.5MB full document.
import { DatabaseSync } from 'node:sqlite'

const BATCH = 50
const WORKERS = 4
const USER_AGENT = 'wikihistory/0.1 (francesco@scrapegraphai.com)'

type Page = { title: string; cirrusdoc?: { source: { incoming_links?: number } }[]; coordinates?: { lat: number; lon: number }[] }
type Response = { error?: { code: string }; query: { normalized?: { from: string; to: string }[]; pages: Page[] } }

const db = new DatabaseSync('data/history.sqlite')
db.exec('CREATE TABLE IF NOT EXISTS articles (article TEXT PRIMARY KEY, inlinks INTEGER NOT NULL, lon REAL, lat REAL)')
if (process.argv.includes('--refresh')) db.exec('DELETE FROM articles')
const pending = (db.prepare('SELECT DISTINCT article FROM events WHERE article NOT IN (SELECT article FROM articles)').all() as { article: string }[]).map(r => r.article)
const save = db.prepare('INSERT OR REPLACE INTO articles VALUES (?, ?, ?, ?)')

async function fetchBatch(articles: string[]) {
  // [Agent] colimit=max matters: coordinates default to 10 per request, which silently dropped the other 40 articles' coordinates in every batch. With coprimary=primary each page has at most one, so 50 fit in one response.
  const params = { action: 'query', prop: 'cirrusdoc|coordinates', cdincludes: 'incoming_links', coprimary: 'primary', colimit: 'max', titles: articles.join('|'), format: 'json', formatversion: '2' }
  const url = `https://en.wikipedia.org/w/api.php?${new URLSearchParams(params)}`
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } }).catch(() => null)
    // [Agent] Wikimedia rate-limits with 429 and a Retry-After in seconds. Waiting exactly that long and retrying is the etiquette, and anything else just prolongs the ban.
    if (res?.status === 429) {
      await new Promise(r => setTimeout(r, (Number(res.headers.get('retry-after')) || 20) * 1000))
      continue
    }
    const body = res?.ok ? ((await res.json().catch(() => null)) as Response | null) : null
    if (body?.query) {
      // [Agent] The API normalises titles (underscores become spaces) and reports the mapping. Walking it backwards lands each row on the title as stored.
      const stored = new Map(articles.map(a => [a, a]))
      for (const { from, to } of body.query.normalized ?? []) stored.set(to, stored.get(from) ?? from)
      db.exec('BEGIN')
      for (const page of body.query.pages) {
        const coord = page.coordinates?.[0]
        save.run(stored.get(page.title) ?? page.title, page.cirrusdoc?.[0]?.source.incoming_links ?? 0, coord?.lon ?? null, coord?.lat ?? null)
      }
      db.exec('COMMIT')
      return
    }
    await new Promise(r => setTimeout(r, 5_000 * attempt))
  }
  console.error(`✗ batch starting ${articles[0]}`)
}

console.log(`${pending.length} articles to fetch`)
const batches = Array.from({ length: Math.ceil(pending.length / BATCH) }, (_, i) => pending.slice(i * BATCH, (i + 1) * BATCH))
let done = 0
await Promise.all(Array.from({ length: WORKERS }, async () => {
  for (let batch = batches.shift(); batch; batch = batches.shift()) {
    await fetchBatch(batch)
    if (++done % 100 === 0) console.log(`  ${done * BATCH} fetched`)
  }
}))
const { located, total } = db.prepare('SELECT count(lat) AS located, count(*) AS total FROM articles').get() as { located: number; total: number }
console.log(`✓ ${total} articles, ${located} with coordinates`)
