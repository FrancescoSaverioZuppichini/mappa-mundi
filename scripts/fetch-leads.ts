// [Agent] Responsibility: English Wikipedia leads → data/history.sqlite, cached per article. One parse call per article (section 0), because only the parser's HTML keeps the links: TextExtracts strips them, and the panel turns links to our own events into in-app links.
// The lead is sanitised here, once: prose paragraphs only, with text, bold, italics and /wiki/ links. lead_html is what the app renders, extract is the same text without markup.
// Resumable: an article is done once it has a row, so a crashed run picks up where it stopped. `--refresh` starts over.

import { DatabaseSync } from 'node:sqlite'
import { parseHTML } from 'linkedom'
import { MIN_INLINKS } from './consts.ts'
import { api, pool } from './wikipedia.ts'

// [Agent] Wikimedia allows 200 requests a minute to an anonymous client with a proper User-Agent and to a new account, 2,000 to an established editor (x-envoy-ratelimited 429s past that). 4 workers reach 200; 8 leave room when WIKIMEDIA_TOKEN earns more.
const WORKERS = 8
// [Agent] Parts of the lead that aren't prose: footnote markers, coordinates, pronunciation and hidden helpers.
const SKIP = 'sup, style, .reference, .mw-ref, .noprint, .mw-empty-elt, #coordinates, .IPA, .rt-commentedText'

// [Agent] Waits for the lock instead of failing, so reading the DB while this runs (an export, a sqlite3 shell) doesn't kill an hours-long run.
const db = new DatabaseSync('data/history.sqlite', { timeout: 30_000 })
db.exec('CREATE TABLE IF NOT EXISTS leads (article TEXT PRIMARY KEY, lead_html TEXT, extract TEXT, fetched_at TEXT NOT NULL)')
if (process.argv.includes('--refresh')) db.exec('DELETE FROM leads')
const save = db.prepare(`INSERT OR REPLACE INTO leads VALUES (?, ?, ?, datetime('now'))`)

// [Agent] Wikipedia HTML → the same HTML with only text, <b>, <i> and <a href="/wiki/…">. Everything else is unwrapped to its text. The app never injects it, so this is about size and clean text, not safety.
function clean(node: Node): string {
  if (node.nodeType === 3) return escapeHtml(node.textContent ?? '')
  if (node.nodeType !== 1) return ''
  const el = node as Element
  const inner = [...el.childNodes].map(clean).join('')
  if (el.tagName === 'B' || el.tagName === 'STRONG') return `<b>${inner}</b>`
  if (el.tagName === 'I' || el.tagName === 'EM') return `<i>${inner}</i>`
  const href = el.tagName === 'A' ? el.getAttribute('href') : null
  return href?.startsWith('/wiki/') ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner
}
const escapeHtml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

// [Agent] Only the article's own top-level paragraphs count: the infobox has <p> tags too. A missing page has no parse and is saved empty, so it isn't asked for again. SKIP parts go first, so each paragraph's textContent is already the clean extract.
async function fetchLead(article: string) {
  const body = await api<{ parse?: { text: string } }>({ action: 'parse', page: article, prop: 'text', section: '0', redirects: '1', disablelimitreport: '1', disableeditsection: '1' })
  if (!body) return console.error(`✗ ${article}`)
  const { document } = parseHTML(`<html><body>${body.parse?.text ?? ''}</body></html>`)
  for (const el of document.querySelectorAll(SKIP)) el.remove()
  const kept = [...document.querySelectorAll('.mw-parser-output > p')].map(p => ({ html: clean(p).trim(), text: p.textContent?.trim() ?? '' })).filter(p => p.text)
  save.run(article, kept.map(p => `<p>${p.html}</p>`).join('') || null, kept.map(p => p.text).join('\n\n') || null)
}

const pending = (
  db.prepare(`SELECT DISTINCT article FROM events JOIN articles USING (article) WHERE inlinks >= ${MIN_INLINKS} AND article NOT IN (SELECT article FROM leads)`).all() as { article: string }[]
).map(r => r.article)
console.log(`${pending.length} leads to fetch`)
await pool(pending, WORKERS, fetchLead, 'leads')

const { total, leads } = db.prepare('SELECT count(*) AS total, count(lead_html) AS leads FROM leads').get() as { total: number; leads: number }
console.log(`✓ ${total} articles, ${leads} with a lead`)
