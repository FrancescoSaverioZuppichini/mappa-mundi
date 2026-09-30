// [Agent] Responsibility: the first-visit tour: four steps that spotlight the real UI and act out what they describe.

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { useHistory } from '../hooks/useHistory'
import type { HistoryStore } from '../types'

// [Agent] The first-visit tour. Each step performs what it describes: it jumps to the First World War so the map re-inks itself as an Industrial-Age atlas, then raises Detail so events visibly fill in. One rounded cutout glides between targets, marked by data-tour attributes on the real UI, so the tour teaches the interface itself rather than pictures of it.
const SEEN_KEY = 'mappa-mundi.tour.v1'

// [Agent] enter runs when the step opens; it may return a cleanup for when the tour moves on.
type Step = {
  target: 'globe' | 'timeline' | 'detail' | 'search'
  place: 'right' | 'above' | 'below'
  title: string
  body: string
  enter?: (history: Pick<HistoryStore, 'update' | 'view'>) => (() => void) | undefined
}

const STEPS: Step[] = [
  {
    target: 'globe',
    place: 'right',
    title: 'Five thousand years, one globe.',
    body: 'Every dot is a moment from Wikipedia, sized by how many articles link to it. The map itself changes with the age you are in.',
  },
  {
    target: 'timeline',
    place: 'above',
    title: 'Travel through time.',
    body: 'Press or drag anywhere on the bar to move through history. Below it, the chronicle names the best events of the years you are in: drag it to pan, click one to open it. Here is the First World War.',
    enter: ({ update }) => {
      update({ time: { year: 1916, span: 4 } })
      return undefined
    },
  },
  {
    target: 'detail',
    place: 'below',
    title: 'The closer you look, the more you see.',
    body: 'Only the most linked events fit at first. Zoom in, pick a shorter span or raise Detail, and the smaller stories surface.',
    enter: ({ update, view }) => {
      // [Agent] Ease Detail up over a second and a half, so events appear one after another instead of in a single jump.
      const from = view.detail
      const started = performance.now()
      let frame = requestAnimationFrame(function step(now) {
        const t = Math.min(1, (now - started) / 1500)
        update({ view: { detail: from + (0.72 - from) * (1 - (1 - t) ** 3) } })
        if (t < 1) frame = requestAnimationFrame(step)
      })
      return () => cancelAnimationFrame(frame)
    },
  },
  {
    target: 'search',
    place: 'below',
    title: 'Open any moment.',
    body: 'Click a dot to read its story and what was happening elsewhere at the same time. Press / to search, or R to let the time machine pick.',
  },
]

type Rect = { x: number; y: number; w: number; h: number; r: number }

function targetRect(target: Step['target']): Rect {
  // [Agent] The globe isn't a DOM element, so its spotlight is a circle centred where the atlas keeps it, sized from the viewport's short side the same way the intro zoom is.
  if (target === 'globe') {
    const r = Math.min(innerWidth, innerHeight) * 0.34
    return { x: innerWidth / 2 - r, y: innerHeight * 0.49 - r, w: r * 2, h: r * 2, r }
  }
  const el = document.querySelector(`[data-tour="${target}"]`)
  const box = el?.getBoundingClientRect() ?? new DOMRect(innerWidth / 2, innerHeight / 2, 0, 0)
  const pad = 8
  return { x: box.x - pad, y: box.y - pad, w: box.width + pad * 2, h: box.height + pad * 2, r: 16 }
}

function readSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) === 'done'
  } catch {
    return false
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, 'done')
  } catch {
    // [Agent] Private windows can refuse storage; the tour then simply shows again next visit.
  }
}

export function Tour() {
  const open = useHistory(s => s.tour)
  const update = useHistory(s => s.update)

  // [Agent] First visit: open after the intro fly-in has mostly landed, so the globe arrives before the words do.
  useEffect(() => {
    if (readSeen()) return
    const timer = setTimeout(() => update({ tour: true }), 1600)
    return () => clearTimeout(timer)
  }, [update])

  // [Agent] Mounting the steps fresh on every open restarts the tour at step one without resetting state by hand.
  return open ? <TourSteps /> : null
}

const CARD_WIDTH = 352
const GAP = 18
const MARGIN = 16

// [Agent] Beside the target on the step's preferred side, then clamped into the viewport using the card's measured height. On a narrow screen there's no room to the right of the globe, so that step falls back to below.
function cardPosition(rect: Rect, place: Step['place'], cardHeight: number) {
  const side = place === 'right' && rect.x + rect.w + GAP + CARD_WIDTH > innerWidth - MARGIN ? 'below' : place
  const clamp = (v: number, max: number) => Math.min(Math.max(v, MARGIN), max - MARGIN)
  if (side === 'right') return { left: rect.x + rect.w + GAP, top: clamp(rect.y + rect.h / 2 - cardHeight / 2, innerHeight - cardHeight) }
  const left = clamp(rect.x + rect.w / 2 - CARD_WIDTH / 2, innerWidth - CARD_WIDTH)
  const top = side === 'above' ? rect.y - GAP - cardHeight : rect.y + rect.h + GAP
  return { left, top: clamp(top, innerHeight - cardHeight) }
}

function TourSteps() {
  const update = useHistory(s => s.update)
  const view = useHistory(s => s.view)
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [cardHeight, setCardHeight] = useState(200)
  const card = useRef<HTMLDivElement>(null)
  const primary = useRef<HTMLButtonElement>(null)

  // [Agent] A step's action runs once when the step opens, with the state as it is then. useEffectEvent reads the latest update and view without making them reasons to re-run.
  const enter = useEffectEvent((index: number) => STEPS[index].enter?.({ update, view }))
  useEffect(() => enter(step), [step])

  useLayoutEffect(() => {
    const measure = () => setRect(targetRect(STEPS[step].target))
    measure()
    addEventListener('resize', measure)
    return () => removeEventListener('resize', measure)
  }, [step])

  // biome-ignore lint/correctness/useExhaustiveDependencies: the card's DOM changes with the step and the target, so it's measured again after either.
  useLayoutEffect(() => {
    if (card.current) setCardHeight(card.current.offsetHeight)
  }, [step, rect])

  // [Agent] Focus moves to the primary button on every step, so keyboard and screen-reader users land inside the dialog rather than on the page behind it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: running on each new step is the point.
  useEffect(() => primary.current?.focus(), [step])

  useEffect(() => {
    // [Agent] Enter on a focused button is left to the button itself, so tabbing to Skip and pressing Enter skips instead of advancing.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement))) next()
      else if (e.key === 'ArrowLeft') setStep(s => Math.max(0, s - 1))
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  })

  function finish() {
    markSeen()
    update({ tour: false })
  }

  function next() {
    if (step === STEPS.length - 1) finish()
    else setStep(step + 1)
  }

  if (!rect) return null
  const { title, body, place } = STEPS[step]
  const position = cardPosition(rect, place, cardHeight)

  return (
    <div className="fixed inset-0 z-50 font-ui" role="dialog" aria-modal="true" aria-label="Introduction">
      {/* [Agent] One rounded box whose giant shadow dims everything else. Its position, size and radius transition, so the spotlight glides between targets. */}
      <div
        className="pointer-events-none absolute shadow-[0_0_0_200vmax_rgba(0,0,0,0.55)] ring-1 ring-highlight/70 transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderRadius: rect.r }}
      />
      <div key={step} ref={card} className="glass absolute max-w-[calc(100vw-2rem)] animate-panel-in rounded-2xl p-5 transition-[top,left] duration-500" style={{ ...position, width: CARD_WIDTH }}>
        <div className="text-[10px] font-medium tracking-[0.24em] text-highlight tabular-nums">
          {String(step + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
        </div>
        <h2 className="mt-2 font-display text-[1.35rem] leading-tight">{title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed opacity-70">{body}</p>
        <div className="mt-5 flex items-center justify-between">
          <div className="flex gap-1.5">
            {STEPS.map(({ title }, i) => (
              <span key={title} className={`h-[3px] rounded-full transition-all duration-500 ${i === step ? 'w-5 bg-highlight' : 'w-1.5 bg-on-space/25'}`} />
            ))}
          </div>
          <div className="flex items-center gap-3 text-[12px]">
            {step < STEPS.length - 1 && (
              <button type="button" onClick={finish} className="opacity-50 transition hover:opacity-90">
                Skip
              </button>
            )}
            <button type="button" ref={primary} onClick={next} className="press rounded-full bg-highlight px-3.5 py-1.5 font-medium text-space hover:brightness-110">
              {step === STEPS.length - 1 ? 'Start exploring' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
