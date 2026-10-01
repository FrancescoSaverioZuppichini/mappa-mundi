import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // [Agent] cloudflare() runs worker/index.ts inside the dev server, with a local D1 (filled by `npm run db:seed`), so /api works in dev exactly as deployed. On build it writes the Worker next to the static files and points `wrangler deploy` at them.
  plugins: [react(), tailwindcss(), cloudflare()],
  // [Agent] MapLibre creates its worker as a module worker, so the bundled worker must be an ES module too.
  worker: { format: 'es' },
})
