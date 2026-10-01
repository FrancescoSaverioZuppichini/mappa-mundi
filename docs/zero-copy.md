# Zero-copy binary for the browser

How Mappa Mundi gets 53,868 events into the browser without parsing them: the homemade `events.bin` that did it first, the traps it had to avoid, and why it became an Arrow file anyway.

## The idea

Write the bytes to disk exactly as they will sit in memory. Loading is then one `fetch().arrayBuffer()`, and "parsing" is just arithmetic: column k starts at byte X and holds n values. `new Float32Array(buffer, byteOffset, length)` is a **view**. It moves no bytes and reads the fetched memory in place. `Float32Array.from(x)`, `view.slice()` and `new Float32Array(otherTypedArray)` are **copies**. `subarray()` is a view. Zero-copy means you only ever create views.

## The layout recipe

1. A fixed header that holds the row count `n`.
2. Columns, not rows (struct-of-arrays). Each column is one contiguous block, so each one becomes one typed array. A row of `f32 ×7 + u8` is 29 bytes, so with rows no column would be contiguous and every other row would be misaligned.
3. Every offset is a formula in `n`. No index, no pointers, no searching.

The old `public/data/events.bin` (`git show 145234e:scripts/export-events.ts`):

```
byte 0     4                4+8n     4+12n    4+16n    4+20n    4+24n    4+28n  4+29n
     +-----+----------------+--------+--------+--------+--------+--------+------+
     | n   | lon,lat x n    | start  | end    | score  | inlinks| sitelnk| cat  |
     | u32 | f32, 8n bytes  | f32    | f32    | f32    | f32    | f32    | u8   |
     +-----+----------------+--------+--------+--------+--------+--------+------+
n = 53,868  ->  4 + 29n = 1,562,176 bytes (1.6MB). Strings lived in events-meta.json (2.3MB).
```

The writer and the reader are the same arithmetic:

```ts
// old scripts/export-events.ts
const buffer = new ArrayBuffer(4 + n * 28 + n)
new Uint32Array(buffer, 0, 1)[0] = n
const start = new Float32Array(buffer, 4 + n * 8, n)
// [Agent] Filling the views fills the single buffer, so the file is simply those bytes.
writeFileSync('public/data/events.bin', new Uint8Array(buffer))

// old src/hooks/useHistory.ts
const buffer = await (await fetch('/data/events.bin')).arrayBuffer()
const n = new Uint32Array(buffer, 0, 1)[0]
const start = new Float32Array(buffer, 4 + n * 8, n)
```

## The rules that bite

### Alignment

The start offset for `Float32Array`, `Int32Array` and `Uint32Array` must be a multiple of 4. For `Float64Array` and `BigInt64Array` it must be a multiple of 8. If it isn't, you get `RangeError: start offset of Float32Array should be a multiple of 4`. That is why:

- The header is exactly one u32, so the f32 columns start at byte 4. A Float64 column would need an 8-byte header, or 4 bytes of padding.
- The u8 column goes last. If it went first, the next column would start at `4 + n`. That happens to work for n = 53,868 (a multiple of 4) and throws on the first export that adds one row.
- If you need mixed widths in any order, pad: `const align = (x, a) => Math.ceil(x / a) * a`, then start each column at `align(previousEnd, itsWidth)`. Another option is to order the columns widest first (f64, f32, u16, u8) after an 8-byte header, which needs no padding at all.

### Endianness

Typed arrays read in the platform's byte order. Every browser and Node target you will ship to (x86-64, ARM) is little-endian: `new Uint8Array(new Uint32Array([1]).buffer)[0] === 1`. Arrow writes little-endian by default and records the byte order in its schema. If a format is big-endian, use `new DataView(buf).getFloat32(offset, false)`. That reads one value at a time, so it is decoding, not zero-copy.

### The Node `Buffer` trap

In the browser, `fetch().arrayBuffer()` returns a fresh ArrayBuffer that is exactly the response body, starting at byte 0. In Node (export scripts, tests), `readFileSync` returns a `Buffer`, which is a Uint8Array *view*, and for small files that view is a slice of a shared pool. This is real output from the example below:

```
file 64B, Buffer at byteOffset 2408 of a 65536B pool
```

`new Float32Array(buf.buffer, 4, n)` on that Buffer reads bytes that sit 2.4KB before your file and belong to something else. You get no error, just garbage. Big files (events.arrow, 5MB) get a buffer of their own, so the bug only appears with tiny test fixtures. There are two fixes:

```js
// [Agent] Copy the file once into its own ArrayBuffer. After that, every offset in the format means exactly what it says.
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
// [Agent] Or stay zero-copy and shift every offset. Alignment still holds because Node starts pool slices on 8-byte boundaries, but that is an implementation detail, not a promise.
const start = new Float32Array(buf.buffer, buf.byteOffset + 4 + n * 8, n)
```

### Strings are never zero-copy

A JS string is an engine object, not a range of bytes, so you cannot make a view of one. The best layout is all the UTF-8 bytes concatenated, plus `n + 1` u32 offsets: string i is `bytes[off[i] .. off[i+1]]`, decoded with `TextDecoder`. The bytes and the offsets are views, but `decode()` always allocates a new string. That is why the old format put its strings in JSON: `JSON.parse` is a fast native decoder, and the strings had to become JS strings anyway. It is also why Arrow's `utf8` columns, which use this exact offsets-plus-bytes layout, still decode on `toArray()`. If you only display a few strings, decode lazily with `column.at(i)`.

### Compression breaks it

Compressed bytes are not the bytes you want in memory, and decompressing writes them into a new buffer. Arrow's optional LZ4/ZSTD buffer compression has the same cost. Ship the file uncompressed and let HTTP compress it: the browser undoes brotli or gzip before `arrayBuffer()` hands you anything, so the views still cost nothing.

events.arrow is 5.0MB raw, 2.0MB gzipped and 1.5MB with brotli (`-q 11`). CDNs decide what to compress based on the content type and may skip binary types, so check:

```sh
curl -sI -H 'Accept-Encoding: br, gzip' https://<host>/data/events.arrow | grep -i content-encoding
```

**What the app does now:** it takes the trade. Wrangler has no content type for `.arrow`, so nothing guaranteed HTTP compression, and Hugging Face serves files raw. So `events.arrow` is ZSTD-compressed Feather: 1.7MB instead of 5.0MB. The browser unzips each column once (~30ms with `fzstd`) and then views it, so there's still no parsing, just no zero-copy over the downloaded bytes.

## How to prove it's zero-copy

```js
// [Agent] The same ArrayBuffer object means the same memory, so nothing was copied.
view.buffer === fetched
// [Agent] Write through the view, then read the raw bytes another way. If the value changed, the two share memory.
view[0] = 99; new DataView(fetched).getFloat32(view.byteOffset, true) === 99
// [Agent] The control: a known copy has to fail the first check, or the check proves nothing.
Float32Array.from(view).buffer !== fetched
```

## Runnable example

`zero-copy.mjs`. It has no dependencies and needs Node 18+. It writes a 3-row file, reads it back with views, and runs the checks above.

```
0     4         4+4n      4+8n             8+12n    8+13n
+-----+---------+---------+----------------+--------+---------------+
| n   | lon f32 | lat f32 | label off u32  | cat u8 | label UTF-8   |
+-----+---------+---------+----------------+--------+---------------+
                            n + 1 values             off[n] bytes
```

```js
import { readFileSync, writeFileSync } from 'node:fs'

const rows = [
  { lon: 12.5, lat: 41.9, cat: 2, label: 'Rome' },
  { lon: -0.1, lat: 51.5, cat: 0, label: 'London' },
  { lon: 139.7, lat: 35.7, cat: 1, label: 'Tōkyō' },
]
// [Agent] Writer and reader share this one function, so the offsets can't drift apart. 4-byte columns come first and u8 ones last, so every start is a multiple of 4 with no padding.
const layout = n => ({ lon: 4, lat: 4 + 4 * n, off: 4 + 8 * n, cat: 8 + 12 * n, text: 8 + 13 * n })

// --- write ---
const utf8 = rows.map(r => new TextEncoder().encode(r.label))
const n = rows.length, L = layout(n)
const out = new ArrayBuffer(L.text + utf8.reduce((s, b) => s + b.length, 0))
new Uint32Array(out, 0, 1)[0] = n
const lon = new Float32Array(out, L.lon, n), lat = new Float32Array(out, L.lat, n)
const off = new Uint32Array(out, L.off, n + 1), cat = new Uint8Array(out, L.cat, n), text = new Uint8Array(out, L.text)
rows.forEach((r, i) => {
  lon[i] = r.lon, lat[i] = r.lat, cat[i] = r.cat
  text.set(utf8[i], off[i])
  off[i + 1] = off[i] + utf8[i].length
})
writeFileSync('tiny.bin', new Uint8Array(out))

// --- read ---
const buf = readFileSync('tiny.bin')
console.log(`file ${buf.byteLength}B, Buffer at byteOffset ${buf.byteOffset} of a ${buf.buffer.byteLength}B pool`)
// [Agent] buf.buffer is Node's shared pool, not the file. Cut the file's bytes out so offset 0 really is byte 0.
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
const R = layout(new Uint32Array(ab, 0, 1)[0])
const rLon = new Float32Array(ab, R.lon, n), rLat = new Float32Array(ab, R.lat, n)
const rOff = new Uint32Array(ab, R.off, n + 1), rCat = new Uint8Array(ab, R.cat, n)
// [Agent] Strings can't be views: subarray() is free, but decode() always builds a new JS string.
const dec = new TextDecoder(), rText = new Uint8Array(ab, R.text, rOff[n])
const labels = Array.from({ length: n }, (_, i) => dec.decode(rText.subarray(rOff[i], rOff[i + 1])))

console.log({ lon: [...rLon], lat: [...rLat], cat: [...rCat], labels })
console.log('rLon.buffer === ab           ', rLon.buffer === ab)
console.log('Float32Array.from shares ab? ', Float32Array.from(rLon).buffer === ab)
rLon[0] = 99
console.log('wrote rLon[0]=99, raw bytes  ', new DataView(ab).getFloat32(R.lon, true))
try { new Float32Array(ab, 5, 1) } catch (e) { console.log('offset 5:', e.name, '-', e.message) }
```

`node zero-copy.mjs` on Node 24.18:

```
file 64B, Buffer at byteOffset 2408 of a 65536B pool
{
  lon: [ 12.5, -0.10000000149011612, 139.6999969482422 ],
  lat: [ 41.900001525878906, 51.5, 35.70000076293945 ],
  cat: [ 2, 0, 1 ],
  labels: [ 'Rome', 'London', 'Tōkyō' ]
}
rLon.buffer === ab            true
Float32Array.from shares ab?  false
wrote rLon[0]=99, raw bytes   99
offset 5: RangeError - start offset of Float32Array should be a multiple of 4
```

`-0.10000000149011612` is f32 rounding, not a bug. f32 keeps about 7 significant digits, which is under 2 m of error on a globe coordinate, at half the bytes of f64. `Tōkyō` takes 7 UTF-8 bytes for 5 characters, which is why you store byte offsets and not character counts.

## Why the project moved to Feather/Arrow anyway

Arrow IPC (Feather v2) is the same trick written down as a standard: contiguous columns, with views over the fetched bytes. Compared with events.bin, it adds:

- **A self-describing file.** A schema and a footer record each column's name, type and byte range. events.bin hardcoded its offsets in two files (`export-events.ts` and `useHistory.ts`) that had to agree. Reorder a column in one, and the other reads garbage without any error.
- **Alignment guaranteed by the spec.** Every buffer starts on an 8-byte boundary and is padded to one: category's 53,868 int8 indices take 53,872 bytes. f64 and int64 columns just work.
- **Nulls.** A validity bitmap stores one bit per row. events.bin had no way to say "missing" short of a sentinel like NaN. `leads.arrow` uses nulls for articles with no lead.
- **Dictionary encoding.** `category` is stored as its 10 names ("war", "battle", ...) once, plus one int8 index per row. Anyone can read it as text, it still costs 1 byte per row, and the indices are an Int8Array view too.
- **Strings in the same file.** There is no second JSON file to fetch and keep in sync.
- **Other tools read it.** pandas (`pd.read_feather`), polars (`pl.read_ipc`), DuckDB and Hugging Face all open it. events.bin needed our TypeScript to decode.

The cost is size: 5.0MB, against 3.9MB for the old 1.6MB bin plus 2.3MB of JSON. Strings account for 3.35MB of the new file: 646KB of offsets, qids stored as `"Q..."` strings rather than numbers, and full article titles where the JSON had stripped the ones it could rebuild. Every column matched the old bin+json exactly for all 53,868 rows.

Reading it with `@uwdata/flechette`:

```ts
import { tableFromIPC } from '@uwdata/flechette'
const bytes = new Uint8Array(await (await fetch('/data/events.arrow')).arrayBuffer())
const table = tableFromIPC(bytes)
const start = table.getChild('start').toArray()
// [Agent] "true 1" means a Float32Array over the fetched bytes, built from a single batch, so there was nothing to stitch together.
console.log(start.buffer === bytes.buffer, table.getChild('start').data.length)
```

This printed `true 1` for all seven numeric columns of the uncompressed events.arrow. The shipped file is now ZSTD-compressed (see [Compression breaks it](#compression-breaks-it)), so its columns are views over the unzipped buffers instead. Zero-copy over the fetched bytes only holds when:

1. **The file is uncompressed.** Call `tableToIPC(table, { format: 'file' })` with no codec.
2. **There is one record batch.** With several batches, a column comes in several chunks and `toArray()` concatenates them into a new array. `tableFromArrays` writes a single batch, and `.data.length` tells you how many you have.
3. **The type maps to a typed array.** float32/64 and int8/16/32 come back as views. int64 comes back as a *copied* Float64Array unless you pass `tableFromIPC(bytes, { useBigInt: true })`, which returns a BigInt64Array view. Strings decode as described above.

One deliberate copy remains: `useHistory.ts` rebuilds `category` with `Uint8Array.from(...)`, mapping names back to `CATEGORIES` ids. The dictionary is stored in first-seen order (`war, epidemic, ...`), not in `CATEGORIES` order (`battle, war, ...`), so the raw indices would point at the wrong colors. That copy is 54KB, so it doesn't matter.
