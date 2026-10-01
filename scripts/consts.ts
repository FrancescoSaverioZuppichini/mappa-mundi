// [Agent] Responsibility: what more than one pipeline script must agree on.

import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import type { Codec } from '@uwdata/flechette'

export const USER_AGENT = 'mappa-mundi/0.1 (francesco@scrapegraphai.com)'

// [Agent] The floor for existing at all. A tenth of articles have zero incoming links and the bottom fifth fewer than ten: orphan stubs nobody links to. fetch-leads.ts fetches text only for articles above it, export-events.ts ships only events above it.
export const MIN_INLINKS = 10

// [Agent] The dataset, as export-events.ts writes it. publish-dataset.ts uploads both to Hugging Face; events.arrow also ships with the app, the very same file, so the site serves its own cached copy.
export const EVENTS_FILE = 'public/data/events.arrow'
export const LEADS_FILE = 'data/release/leads.arrow'

// [Agent] Feather's built-in ZSTD compression, from Node's own zlib. events.arrow drops from 5MB to 1.7MB, and pandas, polars and pyarrow read it natively. Register it with setCompressionCodec(CompressionType.ZSTD, ZSTD) before writing or reading.
export const ZSTD: Codec = {
  encode: bytes => zstdCompressSync(bytes, { params: { [constants.ZSTD_c_compressionLevel]: 19 } }),
  decode: bytes => zstdDecompressSync(bytes),
}
