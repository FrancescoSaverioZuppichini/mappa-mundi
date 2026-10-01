// [Agent] Responsibility: the dataset → Hugging Face (Francesco/mappa-mundi), as one commit: both Feather files and the dataset card. Run after export-events.ts. The token comes from .env (HF_TOKEN), loaded by `npm run data:publish` through node --env-file.

import { pathToFileURL } from 'node:url'
import { createRepo, repoExists, uploadFiles } from '@huggingface/hub'
import { EVENTS_FILE, LEADS_FILE } from './consts.ts'

const repo = { type: 'dataset', name: 'Francesco/mappa-mundi' } as const
const accessToken = process.env.HF_TOKEN
if (!accessToken) throw new Error('HF_TOKEN is missing: put it in .env')

if (!(await repoExists({ repo, accessToken }))) await createRepo({ repo, accessToken, visibility: 'public', license: 'cc-by-sa-4.0' })

// [Agent] Published path → local file, streamed from disk. Names on the command line upload just those: `npm run data:publish -- README.md`.
const only = process.argv.slice(2)
const files = Object.entries({ 'events.arrow': EVENTS_FILE, 'leads.arrow': LEADS_FILE, 'README.md': 'dataset/README.md' }).filter(([path]) => !only.length || only.includes(path))
await uploadFiles({
  repo,
  accessToken,
  commitTitle: `Export of ${new Date().toISOString().slice(0, 10)}`,
  files: files.map(([path, local]) => ({ path, content: pathToFileURL(local) })),
})
console.log(`✓ ${files.map(([path]) => path).join(', ')} → https://huggingface.co/datasets/${repo.name}`)
