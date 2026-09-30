// [Agent] Responsibility: download every font the app uses, once, into public/fonts, so nothing loads from a font CDN at runtime.
// - UI fonts: woff2 files, plus public/fonts/ui.css with their @font-face rules (index.html links it).
// - Map fonts: the TTFs each epoch's labels use (EPOCHS[].mapFonts). MapLibre renders these itself.
// - Licenses: every family is under the SIL Open Font License, which requires its license text to ship with the files, so each one's OFL.txt lands in public/fonts/licenses/.
// Fonts come from fontsource's CDN and licenses from the google/fonts repository. Files already on disk are skipped, so a re-run only fetches what's missing.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { UNICODE_RANGES } from '../src/consts.ts'
import { EPOCHS } from '../src/lib/epochs.ts'

const CDN = 'https://cdn.jsdelivr.net/fontsource/fonts'
const SUBSETS = ['latin', 'latin-ext'] as const

// [Agent] The UI's typefaces: the family name CSS uses, its fontsource id, and the weights the UI draws with.
const UI_FONTS = [
  { name: 'Inter', id: 'inter', weights: [400, 500, 600, 700] },
  { name: 'Source Serif 4', id: 'source-serif-4', weights: [400, 600] },
  { name: 'Cinzel', id: 'cinzel', weights: [400, 600, 700] },
  { name: 'Almendra', id: 'almendra', weights: [400, 700] },
  { name: 'IM Fell English', id: 'im-fell-english', weights: [400] },
  { name: 'Playfair Display', id: 'playfair-display', weights: [400, 600, 700] },
]

// [Agent] false when the file doesn't exist upstream: not every family ships every subset (IM Fell English has no latin-ext).
async function download(url: string, file: string) {
  if (existsSync(file)) return true
  const res = await fetch(url)
  if (!res.ok) return false
  writeFileSync(file, new Uint8Array(await res.arrayBuffer()))
  return true
}

mkdirSync('public/fonts/ui', { recursive: true })
mkdirSync('public/fonts/map', { recursive: true })
mkdirSync('public/fonts/licenses', { recursive: true })

const css: string[] = []
for (const { name, id, weights } of UI_FONTS)
  for (const weight of weights)
    for (const subset of SUBSETS) {
      const file = `${id}-${subset}-${weight}.woff2`
      if (!(await download(`${CDN}/${id}@latest/${subset}-${weight}-normal.woff2`, `public/fonts/ui/${file}`))) continue
      css.push(`@font-face { font-family: '${name}'; font-weight: ${weight}; font-display: swap; src: url(/fonts/ui/${file}) format('woff2'); unicode-range: ${UNICODE_RANGES[subset].join(', ')}; }`)
    }
writeFileSync('public/fonts/ui.css', `${css.join('\n')}\n`)

let map = 0
for (const { family, subset, weight } of EPOCHS.flatMap(e => e.mapFonts)) {
  if (await download(`${CDN}/${family}@latest/${subset}-${weight}-normal.ttf`, `public/fonts/map/${family}-${subset}-${weight}.ttf`)) map++
  else console.error(`✗ map font ${family} ${subset} ${weight}`)
}
// [Agent] google/fonts names each family's folder by its fontsource id without hyphens: source-serif-4 → sourceserif4.
const families = new Set([...UI_FONTS.map(f => f.id), ...EPOCHS.flatMap(e => e.mapFonts.map(f => f.family))])
let licenses = 0
for (const id of families) {
  if (await download(`https://raw.githubusercontent.com/google/fonts/main/ofl/${id.replaceAll('-', '')}/OFL.txt`, `public/fonts/licenses/${id}.txt`)) licenses++
  else console.error(`✗ license for ${id}`)
}
console.log(`✓ ${css.length} UI font files and public/fonts/ui.css, ${map} map font files, ${licenses} licenses`)
