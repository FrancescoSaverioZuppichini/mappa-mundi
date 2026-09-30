// [Agent] Column layout written by scripts/export-events.ts. Rows are sorted by score, a robust, category-weighted in-degree, so the most important come first. inlinks is the raw count shown to people.
export type EventsData = {
  count: number
  positions: Float32Array
  start: Float32Array
  end: Float32Array
  score: Float32Array
  inlinks: Float32Array
  sitelinks: Float32Array
  category: Uint8Array
  qid: number[]
  label: string[]
  article: string[]
}

type Meta = { qid: number[]; label: string[]; article: string[] }

export async function loadEvents(): Promise<EventsData> {
  // [Agent] A missing file behind a dev-server fallback comes back as index.html with a 200, so the status alone isn't enough: a wrong content type is also a failure.
  const load = async (url: string) => {
    const res = await fetch(url)
    if (!res.ok || res.headers.get('content-type')?.includes('text/html')) throw new Error(`Could not load ${url} (${res.status})`)
    return res
  }
  const [buffer, meta] = await Promise.all([
    load('/data/events.bin').then(r => r.arrayBuffer()),
    load('/data/events-meta.json').then(r => r.json() as Promise<Meta>),
  ])
  const count = new Uint32Array(buffer, 0, 1)[0]
  return {
    count,
    positions: new Float32Array(buffer, 4, count * 2),
    start: new Float32Array(buffer, 4 + count * 8, count),
    end: new Float32Array(buffer, 4 + count * 12, count),
    score: new Float32Array(buffer, 4 + count * 16, count),
    inlinks: new Float32Array(buffer, 4 + count * 20, count),
    sitelinks: new Float32Array(buffer, 4 + count * 24, count),
    category: new Uint8Array(buffer, 4 + count * 28, count),
    qid: meta.qid,
    label: meta.label,
    // [Agent] "" means the enwiki title is just the label, which the export strips to save bytes.
    article: meta.article.map((a, i) => a || meta.label[i]),
  }
}
