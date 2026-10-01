// [Agent] Responsibility: leads.arrow → D1, the table the Worker reads. Writes one SQL file that drops and rebuilds the table, then has wrangler run it, so re-seeding after a new export is the same command. Local by default (the dev server's D1); `npm run db:seed -- --remote` fills the deployed one.

import { execFileSync } from 'node:child_process'
import { closeSync, openSync, readFileSync, writeSync } from 'node:fs'
import { CompressionType, setCompressionCodec, tableFromIPC } from '@uwdata/flechette'
import { LEADS_FILE, ZSTD } from './consts.ts'

const remote = process.argv.includes('--remote')
const SQL_FILE = 'data/release/d1.sql'

setCompressionCodec(CompressionType.ZSTD, ZSTD)
const table = tableFromIPC(readFileSync(LEADS_FILE))
const columns = table.names
const values = columns.map(name => table.getChild(name).toArray() as (string | null)[])
const sql = (v: string | null) => (v === null ? 'NULL' : `'${v.replaceAll("'", "''")}'`)

// [Agent] Streamed row by row: the whole file is a few hundred MB of text, too big to build as one string. No BEGIN/COMMIT, because D1 rejects transactions in imported files and makes the import atomic by itself.
const fd = openSync(SQL_FILE, 'w')
// [Agent] Every column of leads.arrow, all text, qid first as the key: D1 holds the same Wikipedia details as the dataset.
writeSync(
  fd,
  `DROP TABLE IF EXISTS leads;\nCREATE TABLE leads (qid TEXT PRIMARY KEY, ${columns
    .slice(1)
    .map(c => `${c} TEXT`)
    .join(', ')});\n`,
)
for (let i = 0; i < table.numRows; i++) writeSync(fd, `INSERT INTO leads VALUES (${values.map(v => sql(v[i])).join(', ')});\n`)
closeSync(fd)

console.log(`${table.numRows} leads → ${SQL_FILE}, seeding ${remote ? 'remote' : 'local'} D1`)
execFileSync('npx', ['wrangler', 'd1', 'execute', 'mappa-mundi', '--file', SQL_FILE, ...(remote ? ['--remote', '--yes'] : ['--local'])], { stdio: 'inherit' })
