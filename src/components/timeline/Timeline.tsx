// [Agent] Responsibility: the bottom bar: Play, explore, the speed stepper, and the timeline canvas (canvas.ts).

import { useEffect, useRef } from 'react'
import { PLAY_SPEEDS, YEAR_MAX, YEAR_MIN } from '../../consts'
import { useHistory } from '../../hooks/useHistory'
import { formatYears, windowOf } from '../../lib/time'
import { ExploreIcon, PauseIcon, PlayIcon } from '../icons'
import { createTimeline } from './canvas'

const STEPPER = 'press grid size-6 place-items-center rounded-full text-[13px] hover:bg-on-space/10 hover:text-on-space disabled:pointer-events-none disabled:opacity-25'

// [Agent] The timeline bar: the imperative canvas timeline, plus Play with its speed and the auto-explore switch (hooks/useHistory.ts runs the playback).
export function Timeline() {
  const ref = useRef<HTMLCanvasElement>(null)
  const { on: playing, speed, explore } = useHistory(s => s.play)
  const time = useHistory(s => s.time)
  const update = useHistory(s => s.update)
  const step = PLAY_SPEEDS.indexOf(speed)
  useEffect(() => createTimeline(ref.current!), [])

  return (
    <div data-tour="timeline" className="glass absolute inset-x-5 bottom-5 flex h-[6.75rem] items-center gap-2 rounded-2xl pl-3 transition-colors duration-700">
      <div className="flex shrink-0 flex-col items-center gap-2">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => update({ play: { on: !playing } })}
            aria-label={playing ? 'Pause' : 'Play through time'}
            title={playing ? 'Pause' : 'Play through time'}
            className="press grid size-9 place-items-center rounded-full text-highlight ring-[0.5px] ring-on-space/30 hover:bg-on-space/10"
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            onClick={() => update({ play: { explore: !explore } })}
            aria-pressed={explore}
            aria-label="Auto-explore while playing"
            title={explore ? 'Auto-explore on: Play opens each headline and follows it' : 'Auto-explore off: Play only moves time'}
            className={`press grid size-9 place-items-center rounded-full ring-[0.5px] hover:bg-on-space/10 ${explore ? 'bg-highlight/15 text-highlight ring-highlight/50' : 'text-on-space/45 ring-on-space/20'}`}
          >
            <ExploreIcon />
          </button>
        </div>
        {/* [Agent] A stepper over the fixed speeds rather than free input: the useful range spans two orders of magnitude, and seven stops cover it in a couple of clicks. */}
        <fieldset aria-label="Playback speed" className="flex items-center font-ui text-[11px] tabular-nums text-on-space/70">
          <button type="button" onClick={() => update({ play: { speed: PLAY_SPEEDS[step - 1] } })} disabled={step === 0} aria-label="Slower" className={STEPPER}>
            −
          </button>
          <span aria-live="polite" className="w-12 text-center">
            {speed} yr/s
          </span>
          <button type="button" onClick={() => update({ play: { speed: PLAY_SPEEDS[step + 1] } })} disabled={step === PLAY_SPEEDS.length - 1} aria-label="Faster" className={STEPPER}>
            +
          </button>
        </fieldset>
      </div>
      {/* [Agent] For assistive tech the canvas is a slider over the years, announcing the current window. The keys themselves are handled in canvas.ts. */}
      <canvas
        ref={ref}
        tabIndex={0}
        role="slider"
        aria-label="Time. Arrow keys move through history, plus and minus narrow or widen the span."
        aria-valuemin={YEAR_MIN}
        aria-valuemax={YEAR_MAX}
        aria-valuenow={Math.round(time.year)}
        aria-valuetext={formatYears(...windowOf(time))}
        className="block h-full min-w-0 flex-1 touch-none rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-highlight/60"
      />
    </div>
  )
}
