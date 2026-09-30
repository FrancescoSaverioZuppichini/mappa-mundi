import { useEffect } from 'react'
import { useStore } from 'zustand'
import type { EventsData } from '../model/events'
import { surprise } from '../state/navigation'
import { store } from '../state/store'
import { DiceIcon } from './icons'

// [Agent] The time-machine button. The die rolls on hover and keeps spinning while the trip is in flight. R triggers it from anywhere except while typing.
export function Surprise({ events }: { events: EventsData }) {
  const travelling = useStore(store, s => s.flight !== null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (e.key.toLowerCase() === 'r' && !typing && !e.metaKey && !e.ctrlKey && !store.getState().tourOpen) surprise(events)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [events])

  return (
    <button
      onClick={() => surprise(events)}
      aria-label="Surprise me: travel to a random moment in history"
      title="Surprise me (R)"
      className="glass press group flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] hover:bg-on-space/10 max-sm:px-2.5"
    >
      <span className={`text-highlight transition-transform duration-500 ease-[var(--ease-out-expo)] group-hover:rotate-90 ${travelling ? 'animate-spin' : ''}`}>
        <DiceIcon />
      </span>
      <span className="max-sm:hidden">Surprise me</span>
    </button>
  )
}
