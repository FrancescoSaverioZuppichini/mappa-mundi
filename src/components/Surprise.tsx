// [Agent] Responsibility: Surprise me: open a random notable event not seen yet this session (the button, or R).

import { useEffect } from 'react'
import { SURPRISE_POOL } from '../consts'
import { events, useHistory } from '../hooks/useHistory'
import { DiceIcon } from './icons'

// [Agent] Events already drawn this session, so the time machine doesn't repeat itself until the pool runs out.
const seen = new Set<number>()

function pickUnseen() {
  const pool = Math.min(SURPRISE_POOL, events.count)
  if (seen.size >= pool) seen.clear()
  let i = Math.floor(Math.random() * pool)
  while (seen.has(i)) i = Math.floor(Math.random() * pool)
  seen.add(i)
  return i
}

// [Agent] The time-machine button: opens a random notable event, and the globe flies there. The die rolls on hover. R triggers it from anywhere except while typing, once per press: holding the key doesn't fire a trip per auto-repeat.
export function Surprise() {
  const update = useHistory(s => s.update)
  const tour = useHistory(s => s.tour)
  const surprise = () => update({ selected: pickUnseen() })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (e.key.toLowerCase() === 'r' && !e.repeat && !typing && !e.metaKey && !e.ctrlKey && !tour) update({ selected: pickUnseen() })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tour, update])

  return (
    <button
      type="button"
      onClick={surprise}
      aria-label="Surprise me: travel to a random moment in history"
      title="Surprise me (R)"
      className="glass press group flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] hover:bg-on-space/10 max-sm:px-2.5"
    >
      <span className="text-highlight transition-transform duration-500 ease-[var(--ease-out-expo)] group-hover:rotate-90">
        <DiceIcon />
      </span>
      <span className="max-sm:hidden">Surprise me</span>
    </button>
  )
}
