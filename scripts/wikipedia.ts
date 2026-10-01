// [Agent] Responsibility: talking to the English Wikipedia API, for every script that does: one polite request, a small worker pool, and mapping the API's rewritten titles back to ours.

import { USER_AGENT } from './consts.ts'

// [Agent] With WIKIMEDIA_TOKEN in .env (an owner-only OAuth 2 token from meta.wikimedia.org), requests count against your account's rate limit instead of the anonymous one.
const headers = { 'User-Agent': USER_AGENT, ...(process.env.WIKIMEDIA_TOKEN && { Authorization: `Bearer ${process.env.WIKIMEDIA_TOKEN}` }) }

// [Agent] Wikimedia rate-limits with 429 and a Retry-After in seconds. Waiting exactly that long is the etiquette, and anything else just prolongs the ban. Other failures back off and retry, then give up with null, which leaves the work pending for the next run. An API-level error is a valid answer and comes back as the body.
export async function api<T>(params: Record<string, string>): Promise<T | null> {
  const url = `https://en.wikipedia.org/w/api.php?${new URLSearchParams({ ...params, format: 'json', formatversion: '2' })}`
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url, { headers }).catch(() => null)
    // [Agent] An unread body keeps its socket open until garbage collection. Under a steady stream of 429s that ran the process out of file descriptors, and SQLite then couldn't open its journal.
    if (res && !res.ok) await res.body?.cancel()
    if (res?.status === 429) {
      await new Promise(r => setTimeout(r, (Number(res.headers.get('retry-after')) || 20) * 1000))
      continue
    }
    const body = res?.ok ? ((await res.json().catch(() => null)) as T | null) : null
    if (body) return body
    await new Promise(r => setTimeout(r, 5_000 * attempt))
  }
  return null
}

export async function pool<T>(jobs: T[], workers: number, run: (job: T) => Promise<void>, label: string) {
  const total = jobs.length
  let done = 0
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (let job = jobs.shift(); job !== undefined; job = jobs.shift()) {
        await run(job)
        if (++done % 1000 === 0) console.log(`  ${label} ${done}/${total}`)
      }
    }),
  )
}

export const chunks = <T>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))

// [Agent] The API normalises titles (underscores become spaces) and reports the mapping. Walking it backwards lands each page on the title as stored.
export function storedTitles(articles: string[], normalized: { from: string; to: string }[] = []) {
  const stored = new Map(articles.map(a => [a, a]))
  for (const { from, to } of normalized) stored.set(to, stored.get(from) ?? from)
  return stored
}
