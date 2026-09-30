import { EPOCHS, type Texture } from '../model/epochs'

// [Agent] Map textures are painted procedurally the first time MapLibre asks for them (the missing-image resolver), so nothing is downloaded and only the epochs you visit pay the cost. Image ids are "<epoch>-land", "<epoch>-ocean" and "rose".
const SIZE = 256

export function textureImage(id: string): ImageData | null {
  if (id === 'rose') {
    const sail = EPOCHS.find(e => e.map.rhumbs)!
    return paintCompassRose(sail.map.rhumbs!.main, sail.map.rhumbs!.half, sail.map.land)
  }
  const [epochId, part] = id.split('-')
  const epoch = EPOCHS.find(e => e.id === epochId)
  const kind = part === 'land' ? epoch?.map.landTexture : epoch?.map.oceanTexture
  if (!epoch || !kind) return null
  return paintTexture(kind, part === 'land' ? epoch.map.land : epoch.map.ocean, epoch.ui.ink)
}

function paintTexture(kind: Texture, base: string, ink: string): ImageData {
  const ctx = new OffscreenCanvas(SIZE, SIZE).getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = base
  ctx.fillRect(0, 0, SIZE, SIZE)

  // [Agent] The texture repeats as a pattern, so any stroke that crosses an edge is drawn again shifted by one tile in every direction. The seams then line up.
  const seamless = (draw: () => void) => {
    for (const dx of [-SIZE, 0, SIZE])
      for (const dy of [-SIZE, 0, SIZE]) {
        ctx.save()
        ctx.translate(dx, dy)
        draw()
        ctx.restore()
      }
  }

  if (kind === 'papyrus') {
    // [Agent] Papyrus is two layers of pressed reed strips, so we lay long wavy horizontal fibres first and fainter vertical ones on top.
    for (let i = 0; i < 180; i++) {
      const y = Math.random() * SIZE
      const vertical = i > 120
      const wobble = Math.random() * 3
      ctx.strokeStyle = Math.random() < 0.5 ? ink : '#ffffff'
      ctx.globalAlpha = (vertical ? 0.03 : 0.06) + Math.random() * 0.06
      ctx.lineWidth = 0.5 + Math.random() * 1.8
      seamless(() => {
        ctx.beginPath()
        for (let x = 0; x <= SIZE; x += 16) {
          const offset = y + Math.sin((x / SIZE) * Math.PI * 2 * (1 + (i % 3))) * wobble
          if (vertical) ctx.lineTo(offset, x)
          else ctx.lineTo(x, offset)
        }
        ctx.stroke()
      })
    }
  }

  if (kind === 'vellum') {
    // [Agent] Vellum is calfskin: soft uneven blotches rather than fibres.
    for (let i = 0; i < 46; i++) {
      const x = Math.random() * SIZE
      const y = Math.random() * SIZE
      const r = 18 + Math.random() * 60
      const blotch = ctx.createRadialGradient(x, y, 0, x, y, r)
      blotch.addColorStop(0, Math.random() < 0.6 ? ink : '#ffffff')
      blotch.addColorStop(1, 'transparent')
      ctx.globalAlpha = 0.03 + Math.random() * 0.04
      ctx.fillStyle = blotch
      seamless(() => ctx.fillRect(x - r, y - r, r * 2, r * 2))
    }
  }

  if (kind === 'waves') {
    // [Agent] The medieval sea convention: rows of small crests, every other row shifted half a step. The 32px step divides the tile evenly, so the grid stays seamless on its own.
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.2
    for (let row = 0; row < SIZE / 16; row++)
      for (let col = 0; col < SIZE / 32; col++) {
        const cx = col * 32 + (row % 2) * 16 + 8
        const cy = row * 16 + 10
        ctx.globalAlpha = 0.16 + Math.random() * 0.1
        ctx.beginPath()
        ctx.arc(cx - 4, cy, 4, Math.PI * 1.1, Math.PI * 1.9)
        ctx.arc(cx + 4, cy, 4, Math.PI * 1.1, Math.PI * 1.9)
        ctx.stroke()
      }
  }

  if (kind === 'engraving') {
    // [Agent] Copper-plate atlases shaded the sea with fine horizontal rules. A 4px pitch divides 256, so the lines tile cleanly.
    ctx.fillStyle = ink
    ctx.globalAlpha = 0.13
    for (let y = 0; y < SIZE; y += 4) ctx.fillRect(0, y, SIZE, 1)
  }

  // [Agent] A last layer of per-pixel grain on every texture. Flat colour reads as digital, grain reads as paper. Per-pixel noise has no structure, so it tiles seamlessly.
  const image = ctx.getImageData(0, 0, SIZE, SIZE)
  const amount = kind === 'grain' ? 14 : 7
  for (let p = 0; p < image.data.length; p += 4) {
    const n = (Math.random() - 0.5) * amount
    image.data[p] += n
    image.data[p + 1] += n
    image.data[p + 2] += n
  }
  return image
}

// [Agent] A 16-wind portolan rose. The eight main winds are long two-tone points and the half winds shorter ones in the second ink. One ImageData, drawn once.
function paintCompassRose(main: string, half: string, paper: string): ImageData {
  const size = 192
  const c = size / 2
  const ctx = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true })!
  ctx.lineWidth = 1.2

  ctx.strokeStyle = main
  ctx.globalAlpha = 0.8
  for (const r of [c - 6, c - 12]) {
    ctx.beginPath()
    ctx.arc(c, c, r, 0, Math.PI * 2)
    ctx.stroke()
  }

  for (let wind = 15; wind >= 0; wind--) {
    const isMain = wind % 2 === 0
    const angle = (wind * Math.PI) / 8 - Math.PI / 2
    const length = wind % 4 === 0 ? c - 4 : isMain ? c * 0.72 : c * 0.5
    const width = isMain ? 12 : 7
    const tip = [c + Math.cos(angle) * length, c + Math.sin(angle) * length]
    const left = [c + Math.cos(angle - Math.PI / 2) * width, c + Math.sin(angle - Math.PI / 2) * width]
    const right = [c + Math.cos(angle + Math.PI / 2) * width, c + Math.sin(angle + Math.PI / 2) * width]
    // [Agent] Each point is two triangles, one filled with ink and one with paper, which gives the classic shaded-facet look.
    for (const [side, fill] of [[left, isMain ? main : half], [right, paper]] as const) {
      ctx.globalAlpha = 1
      ctx.fillStyle = fill
      ctx.strokeStyle = main
      ctx.beginPath()
      ctx.moveTo(c, c)
      ctx.lineTo(side[0], side[1])
      ctx.lineTo(tip[0], tip[1])
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
  }
  return ctx.getImageData(0, 0, size, size)
}
