import { CATEGORIES } from '../model/categories'
import { EPOCHS, epochAt, type Epoch } from '../model/epochs'
import type { EventsData } from '../model/events'
import { headlineOf, rankWindow } from '../model/rank'
import { formatYears, momentAt, tToYear, YEAR_MAX, YEAR_MIN, yearToT, type TimeWindow } from '../model/time'
import { focus, moveTo } from '../state/navigation'
import { store } from '../state/store'

const PAD = 16
const BINS = 1600
const UI_FONT = "'Inter', system-ui, sans-serif"
// [Agent] Tick levels from coarse to fine. A level only draws where its ticks land far enough apart, so narrow bars show centuries and wide ones show decades.
const TICK_STEPS = [1000, 500, 100, 50, 10, 5, 1]

// [Agent] Three bands, top to bottom, from coarse to fine. Era tabs; the overview, all of history on a log scale with the lens on it; and the chronicle, the lens magnified to a linear run of years with its best events labelled in order.
const ERA_ROW = 20
const BAR_TOP = 25
const BAR_BOTTOM = 47
const CHRONICLE_TOP = 64
const ROW_GAP = 14
const CHRONICLE_ROWS = 2
// [Agent] The chronicle tries this many of the window's top-ranked events before giving up on filling the rows.
const CHRONICLE_TRIES = 400
const MAX_TITLE_CHARS = 30
// [Agent] A press on the chronicle that moves less than this is a click on a label, not a drag.
const CLICK_SLOP = 4

type Label = { i: number; x: number; row: number; year: string; title: string; yearWidth: number; x1: number }
type Drag = { band: 'overview' } | { band: 'chronicle'; fromX: number; fromYear: number; moved: boolean }

// [Agent] A Canvas 2D bar living outside React: pointer input writes the time window straight into the store, and store changes redraw the bar. Returns the cleanup.
// The bar is a scrubber, not a range picker. The time window is a lens with a span in years (the header's span buttons, or the wheel), and pressing or dragging anywhere on the overview centres it there, like a video playhead, so there are no handles to aim at. Dragging the chronicle pans the lens at its own finer scale, and clicking a label opens that event.
export function createTimeline(canvas: HTMLCanvasElement, events: EventsData) {
  const ctx = canvas.getContext('2d')!
  let width = 0
  let height = 0
  let pointer: { x: number; y: number } | null = null
  let drag: Drag | null = null
  let hot: number | null = null
  let frame = 0
  let labels: Label[] = []
  let laidOut: { timeWindow: TimeWindow; hidden: number[]; selected: number | null; width: number } | null = null

  // [Agent] Event density per slice of the (log-scaled) bar, counted once. Heights are log-scaled too, so the 20th century doesn't flatten antiquity into nothing.
  const bins = new Uint32Array(BINS)
  for (let i = 0; i < events.count; i++) bins[Math.min(BINS - 1, Math.floor(yearToT(events.start[i]) * BINS))]++
  const maxLog = Math.log1p(bins.reduce((a, b) => Math.max(a, b), 0))

  const xAt = (t: number) => PAD + t * (width - 2 * PAD)
  const tAt = (x: number) => Math.min(1, Math.max(0, (x - PAD) / (width - 2 * PAD)))
  const eraSpan = (e: Epoch): [number, number] => [e.from, EPOCHS[EPOCHS.indexOf(e) + 1]?.from ?? YEAR_MAX]
  const eraAt = (x: number) => EPOCHS.findLast(e => xAt(yearToT(e.from)) <= x) ?? EPOCHS[0]
  const axisY = () => height - 8

  // [Agent] Greedy, like the map's placement: the window's events in rank order, each taking the first row where its label and its stem fit. The open event goes first so it's always there. Panning shifts every x by the same amount, so the same labels survive a pan; only events entering or leaving the window change the picture.
  function layoutChronicle() {
    const { timeWindow, hiddenCategories, selected } = store.getState()
    if (laidOut?.timeWindow === timeWindow && laidOut.hidden === hiddenCategories && laidOut.selected === selected && laidOut.width === width) return
    laidOut = { timeWindow, hidden: hiddenCategories, selected, width }
    const [start, end] = timeWindow
    const ranked = rankWindow(events, timeWindow, hiddenCategories).slice(0, CHRONICLE_TRIES)
    if (selected !== null && events.start[selected] <= end && events.end[selected] >= start) ranked.unshift(selected)
    const rows: [number, number][][] = Array.from({ length: CHRONICLE_ROWS }, () => [])
    const free = (row: number, x0: number, x1: number) => rows[row].every(([a, b]) => x1 <= a || x0 >= b)
    labels = []
    const seen = new Set<number>()
    for (const i of ranked) {
      if (seen.has(i)) continue
      seen.add(i)
      // [Agent] An event that began before the window hangs from its left edge.
      const x = PAD + ((Math.max(events.start[i], start) - start) / (end - start)) * (width - 2 * PAD)
      const label = events.label[i]
      // [Agent] "2008 Summer Olympics" already says its year, so it isn't printed twice.
      const year = label.startsWith(formatYears(events.start[i])) ? '' : formatYears(events.start[i])
      const title = label.length > MAX_TITLE_CHARS ? `${label.slice(0, MAX_TITLE_CHARS - 1)}…` : label
      ctx.font = `500 10.5px ${UI_FONT}`
      const yearWidth = ctx.measureText(year).width
      ctx.font = `10.5px ${UI_FONT}`
      const x1 = x + 4 + (year ? yearWidth + 5 : 0) + ctx.measureText(title).width
      if (x1 > width - 4) continue
      for (let row = 0; row < CHRONICLE_ROWS; row++) {
        if (!free(row, x - 3, x1 + 8)) continue
        if (!rows.slice(0, row).every((_, below) => free(below, x - 2, x + 2))) continue
        rows[row].push([x - 3, x1 + 8])
        for (let below = 0; below < row; below++) rows[below].push([x - 2, x + 2])
        labels.push({ i, x, row, year, title, yearWidth, x1 })
        break
      }
    }
  }

  function draw() {
    frame = 0
    const { year, span, timeWindow, hiddenCategories, selected } = store.getState()
    const epoch = epochAt(year)
    // [Agent] The bar is smoked glass over the dark space, so it draws in the on-space palette: light hairlines, with the epoch's highlight for everything selected.
    const { onSpace: ink, highlight: accent, space } = epoch.ui
    const hoveredEra = pointer && pointer.y < ERA_ROW && !drag ? eraAt(pointer.x) : null
    const wx0 = xAt(yearToT(timeWindow[0]))
    const wx1 = xAt(yearToT(timeWindow[1]))
    const cx = xAt(yearToT(year))
    const axis = axisY()

    ctx.clearRect(0, 0, width, height)
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'

    // [Agent] Era tabs: each era's name in its own typeface, centred over its span, with a hairline divider between eras. The current era is set in the highlight over a thin underline, and a hovered one brightens. They read like the section tabs of an atlas.
    for (const e of EPOCHS) {
      const [from, to] = eraSpan(e)
      const x0 = xAt(yearToT(from))
      const x1 = xAt(yearToT(to))
      const current = e === epoch
      ctx.globalAlpha = 0.12
      ctx.fillStyle = ink
      ctx.fillRect(x0, 5, 0.5, ERA_ROW - 8)
      if (current) {
        ctx.globalAlpha = 0.9
        ctx.fillStyle = accent
        ctx.fillRect(x0 + 8, ERA_ROW - 1, x1 - x0 - 16, 1)
      }
      ctx.globalAlpha = current ? 1 : e === hoveredEra ? 0.8 : 0.4
      ctx.fillStyle = current ? accent : ink
      ctx.font = `12px ${e.font}`
      if (x1 - x0 > ctx.measureText(e.name).width + 16) ctx.fillText(e.name, (x0 + x1) / 2, ERA_ROW / 2 + 1)
    }

    // [Agent] The histogram is drawn twice as hairlines: dim everywhere, then clipped to the lens in the accent colour. That costs two fillStyle switches instead of one per bin.
    const drawBins = () => {
      for (let b = 0; b < BINS; b++) {
        if (!bins[b]) continue
        const h = ((BAR_BOTTOM - BAR_TOP) * Math.log1p(bins[b])) / maxLog
        ctx.fillRect(xAt(b / BINS), BAR_BOTTOM - h, 0.6, h)
      }
    }
    ctx.globalAlpha = 0.2
    ctx.fillStyle = ink
    drawBins()
    ctx.save()
    ctx.beginPath()
    ctx.rect(wx0, 0, wx1 - wx0, height)
    ctx.clip()
    ctx.globalAlpha = 0.9
    ctx.fillStyle = accent
    drawBins()
    ctx.restore()

    // [Agent] The funnel: a faint wash from the lens down to the full width of the chronicle, so it reads as the lens magnified.
    ctx.globalAlpha = 0.05
    ctx.fillStyle = accent
    ctx.beginPath()
    ctx.moveTo(wx0, BAR_BOTTOM)
    ctx.lineTo(wx1, BAR_BOTTOM)
    ctx.lineTo(width - PAD, CHRONICLE_TOP)
    ctx.lineTo(width - PAD, height)
    ctx.lineTo(PAD, height)
    ctx.lineTo(PAD, CHRONICLE_TOP)
    ctx.closePath()
    ctx.fill()

    // [Agent] The lens: a faint wash between hairline edges, and the playhead with a slim knob. The knob widens while held. A narrow span can be under a pixel wide on the bar, so the playhead is what marks where you are. On the log bar it sits off the lens's visual middle, and at either end of history the lens is clipped, so it isn't drawn as the midpoint.
    ctx.globalAlpha = 0.07
    ctx.fillRect(wx0, BAR_TOP, wx1 - wx0, BAR_BOTTOM - BAR_TOP)
    ctx.globalAlpha = 0.4
    ctx.fillRect(wx0 - 0.25, BAR_TOP, 0.5, BAR_BOTTOM - BAR_TOP)
    ctx.fillRect(wx1 - 0.25, BAR_TOP, 0.5, BAR_BOTTOM - BAR_TOP)
    ctx.globalAlpha = 1
    ctx.fillRect(cx - 0.5, BAR_TOP - 2, 1, BAR_BOTTOM - BAR_TOP + 4)
    const knob = drag?.band === 'overview' ? 7 : 5
    ctx.beginPath()
    ctx.roundRect(cx - knob / 2, (BAR_TOP + BAR_BOTTOM) / 2 - 6, knob, 12, knob / 2)
    ctx.fill()

    ctx.font = `10px ${UI_FONT}`
    ctx.fillStyle = ink
    ctx.strokeStyle = ink
    ctx.lineWidth = 1
    ctx.textBaseline = 'alphabetic'
    TICK_STEPS.forEach((step, level) => {
      const coarser = TICK_STEPS[level - 1]
      for (let y = Math.ceil(YEAR_MIN / step) * step; y <= YEAR_MAX; y += step) {
        if (coarser && y % coarser === 0) continue
        const x = xAt(yearToT(y))
        // [Agent] Spacing to the nearer neighbour decides what this tick may draw. At either end of the bar the missing neighbour measures 0, and `|| Infinity` makes it not count.
        const gap = Math.min(
          x - xAt(yearToT(Math.max(y - step, YEAR_MIN))) || Infinity,
          xAt(yearToT(Math.min(y + step, YEAR_MAX))) - x || Infinity)
        if (gap < 5) continue
        ctx.globalAlpha = Math.min(1, (gap - 5) / 12) * 0.35
        ctx.beginPath()
        ctx.moveTo(x, BAR_BOTTOM)
        ctx.lineTo(x, BAR_BOTTOM + (level < 3 ? 4 : 2))
        ctx.stroke()
        if (gap < 30) continue
        // [Agent] A label needs its own width in free space, and it is skipped when it would poke past the bar's edge instead of being shoved inward into its neighbour.
        const text = formatYears(y)
        const w = ctx.measureText(text).width
        if (gap < w + 12 || x - w / 2 < 2 || x + w / 2 > width - 2) continue
        ctx.globalAlpha = 0.5
        ctx.fillText(text, x, BAR_BOTTOM + 14)
      }
    })

    // [Agent] The chronicle: an axis, and for each label a dot in its category colour with a stem up to its row. The year is set dimmer than the title so the eye runs along the names. The open event is set in the highlight, and the hovered one brightens.
    layoutChronicle()
    ctx.globalAlpha = 0.25
    ctx.fillRect(PAD, axis, width - 2 * PAD, 0.5)
    ctx.textAlign = 'left'
    for (const { i, x, row, year, title, yearWidth } of labels) {
      const baseline = axis - 7 - row * ROW_GAP
      const lit = i === hot || i === selected
      ctx.globalAlpha = lit ? 0.6 : 0.22
      ctx.fillStyle = ink
      ctx.fillRect(x - 0.25, baseline - 8, 0.5, axis - baseline + 8)
      ctx.globalAlpha = 1
      ctx.fillStyle = CATEGORIES[events.category[i]].color
      ctx.beginPath()
      ctx.arc(x, axis, lit ? 3.5 : 2.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = i === selected ? accent : ink
      ctx.globalAlpha = lit ? 0.7 : 0.45
      ctx.font = `500 10.5px ${UI_FONT}`
      ctx.fillText(year, x + 4, baseline)
      ctx.globalAlpha = lit ? 1 : 0.8
      ctx.font = `10.5px ${UI_FONT}`
      ctx.fillText(title, x + 4 + (year ? yearWidth + 5 : 0), baseline)
    }

    // [Agent] The preview chip over the overview: a year and its headline, the event the map would lead with if the lens sat there, so the bar can be read before anything moves. It follows the pointer on hover and the playhead while scrubbing.
    const probe = drag?.band === 'overview' ? cx : pointer && !drag && pointer.y >= ERA_ROW && pointer.y < CHRONICLE_TOP ? pointer.x : null
    if (probe !== null) {
      if (!drag) {
        ctx.globalAlpha = 0.5
        ctx.fillStyle = ink
        ctx.fillRect(probe - 0.25, BAR_TOP, 0.5, BAR_BOTTOM - BAR_TOP)
      }
      const at = tToYear(tAt(probe))
      const headline = headlineOf(events, momentAt(at, span).timeWindow, hiddenCategories)
      const year = formatYears(at)
      const label = headline === null ? '' : events.label[headline]
      const title = label.length > MAX_TITLE_CHARS ? `${label.slice(0, MAX_TITLE_CHARS - 1)}…` : label
      ctx.font = `500 10px ${UI_FONT}`
      const yearWidth = ctx.measureText(year).width
      ctx.font = `10px ${UI_FONT}`
      const titleWidth = title ? ctx.measureText(title).width + 15 : 0
      const w = yearWidth + titleWidth + 10
      const px = Math.min(Math.max(probe - w / 2, 2), width - w - 2)
      ctx.globalAlpha = 0.95
      ctx.fillStyle = ink
      ctx.beginPath()
      ctx.roundRect(px, BAR_TOP - 1, w, 15, 3)
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.fillStyle = space
      ctx.font = `500 10px ${UI_FONT}`
      ctx.fillText(year, px + 5, BAR_TOP + 10)
      if (headline !== null) {
        ctx.fillStyle = CATEGORIES[events.category[headline]].color
        ctx.beginPath()
        ctx.arc(px + yearWidth + 11, BAR_TOP + 6.5, 2.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 0.75
        ctx.fillStyle = space
        ctx.font = `10px ${UI_FONT}`
        ctx.fillText(title, px + yearWidth + 17, BAR_TOP + 10)
      }
    }
    ctx.globalAlpha = 1
  }

  function requestDraw() {
    if (!frame) frame = requestAnimationFrame(draw)
  }

  function labelAt(x: number, y: number) {
    const axis = axisY()
    return labels.find(l => x >= l.x - 3 && x <= l.x1 + 3 && y >= axis - 7 - l.row * ROW_GAP - 10 && y <= axis - 7 - l.row * ROW_GAP + 3)?.i ?? null
  }

  function onPointerDown(e: PointerEvent) {
    if (e.offsetY < ERA_ROW) {
      // [Agent] An era tab jumps to the start of that era and keeps the span, so it's a jump, not a change of scale.
      const { span } = store.getState()
      moveTo(eraAt(e.offsetX).from + span / 2)
      return
    }
    canvas.setPointerCapture(e.pointerId)
    if (e.offsetY < CHRONICLE_TOP) {
      drag = { band: 'overview' }
      moveTo(tToYear(tAt(e.offsetX)))
    } else drag = { band: 'chronicle', fromX: e.offsetX, fromYear: store.getState().year, moved: false }
    canvas.style.cursor = 'grabbing'
    requestDraw()
  }

  function onPointerMove(e: PointerEvent) {
    pointer = { x: e.offsetX, y: e.offsetY }
    requestDraw()
    if (drag?.band === 'overview') return moveTo(tToYear(tAt(e.offsetX)))
    if (drag?.band === 'chronicle') {
      const dx = e.offsetX - drag.fromX
      if (Math.abs(dx) > CLICK_SLOP) drag.moved = true
      // [Agent] Grab-and-pan, like a map: the years under the pointer stay under it.
      const [start, end] = store.getState().timeWindow
      if (drag.moved) moveTo(drag.fromYear - (dx / (width - 2 * PAD)) * (end - start))
      return
    }
    const next = e.offsetY >= CHRONICLE_TOP ? labelAt(e.offsetX, e.offsetY) : null
    if (next !== hot) hot = next
    canvas.style.cursor = e.offsetY < ERA_ROW || hot !== null ? 'pointer' : 'grab'
  }

  function onPointerUp(e: PointerEvent) {
    if (drag?.band === 'chronicle' && !drag.moved) {
      const i = labelAt(e.offsetX, e.offsetY)
      if (i !== null) focus(events, i)
    }
    drag = null
    canvas.style.cursor = 'grab'
    requestDraw()
  }

  function onPointerLeave() {
    if (drag) return
    pointer = null
    hot = null
    requestDraw()
  }

  // [Agent] A touch the browser takes over for scrolling or a gesture never sends pointerup, so the drag has to end here as well or it would stick.
  function onPointerCancel() {
    drag = null
    pointer = null
    hot = null
    requestDraw()
  }

  // [Agent] The same moves from the keyboard: arrows step the lens by half its span, so each press moves on with some overlap, and + and − narrow or widen it.
  function onKeyDown(e: KeyboardEvent) {
    const { year, span } = store.getState()
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') moveTo(year + (e.key === 'ArrowLeft' ? -span : span) / 2)
    else if (e.key === '+' || e.key === '=' || e.key === '-') moveTo(year, span * (e.key === '-' ? 1.25 : 0.8))
    else return
    e.preventDefault()
  }

  // [Agent] Trackpads send a sideways swipe as deltaX, and it pans the lens at the chronicle's scale. Vertical scroll widens or narrows the span around its centre, so the moment in view stays put.
  function onWheel(e: WheelEvent) {
    e.preventDefault()
    const { year, span, timeWindow: [start, end] } = store.getState()
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) moveTo(year + (e.deltaX / (width - 2 * PAD)) * (end - start))
    else moveTo(year, span * Math.exp(e.deltaY * 0.0015))
  }

  const resize = new ResizeObserver(([entry]) => {
    const dpr = window.devicePixelRatio
    width = entry.contentRect.width
    height = entry.contentRect.height
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw()
  })
  resize.observe(canvas)

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointerleave', onPointerLeave)
  canvas.addEventListener('pointercancel', onPointerCancel)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('keydown', onKeyDown)
  const unsubscribe = store.subscribe((state, prev) => {
    if (state.timeWindow !== prev.timeWindow || state.year !== prev.year || state.selected !== prev.selected || state.hiddenCategories !== prev.hiddenCategories) requestDraw()
  })

  return () => {
    unsubscribe()
    resize.disconnect()
    cancelAnimationFrame(frame)
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointerleave', onPointerLeave)
    canvas.removeEventListener('pointercancel', onPointerCancel)
    canvas.removeEventListener('wheel', onWheel)
    canvas.removeEventListener('keydown', onKeyDown)
  }
}
