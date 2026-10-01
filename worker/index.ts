// [Agent] Responsibility: the one thing static files can't do: hand out one event's Wikipedia lead from D1. Only /api/* reaches this code (run_worker_first in wrangler.jsonc). Every other request is a static file Cloudflare serves without running a Worker.

import type { Lead } from '../src/types'

export default {
  async fetch(request, env, ctx) {
    // [Agent] Cloudflare's CDN doesn't cache what a Worker returns, so the Cache API does: each event is read from D1 once per data centre per day, not once per visitor.
    const cached = await caches.default.match(request)
    if (cached) return cached
    const qid = new URL(request.url).pathname.match(/^\/api\/leads\/(Q\d+)$/)?.[1]
    const lead = qid && (await env.DB.prepare('SELECT description, lead_html, thumbnail FROM leads WHERE qid = ?').bind(qid).first<Lead>())
    if (!lead) return new Response('Not found', { status: 404 })
    const response = Response.json(lead, { headers: { 'Cache-Control': 'public, max-age=86400' } })
    ctx.waitUntil(caches.default.put(request, response.clone()))
    return response
  },
} satisfies ExportedHandler<Env>
