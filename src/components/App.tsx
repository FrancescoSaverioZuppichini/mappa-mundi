// [Agent] Responsibility: the page: the order the parts are layered in, and the epoch's colours as CSS variables.

import { useEffect } from 'react'
import { useHistory } from '../hooks/useHistory'
import { epochAt } from '../lib/epochs'
import { EventPanel } from './EventPanel'
import { Globe } from './globe/Globe'
import { Header } from './Header'
import { Search } from './Search'
import { Tour } from './Tour'
import { Timeline } from './timeline/Timeline'

// [Agent] The page: layout, layers and the epoch theme. Everything interactive lives in its own component.
export function App() {
  // [Agent] The selector returns one of the EPOCHS objects, so React only re-renders when the epoch actually changes, not on every scrub frame.
  const epoch = useHistory(s => epochAt(s.time.year))

  // [Agent] The epoch's UI tokens become CSS variables that Tailwind's theme points at (index.css), so the whole chrome restyles and cross-fades on its own.
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--paper', epoch.ui.paper)
    root.setProperty('--ink', epoch.ui.ink)
    root.setProperty('--accent', epoch.ui.accent)
    root.setProperty('--space', epoch.ui.space)
    root.setProperty('--on-space', epoch.ui.onSpace)
    root.setProperty('--highlight', epoch.ui.highlight)
    root.setProperty('--display-font', epoch.font)
  }, [epoch])

  return (
    <main className="fixed inset-0 overflow-hidden bg-space font-ui text-ink transition-colors duration-700">
      {/* [Agent] A faint glow behind the globe in the epoch's highlight, so the globe sits in light rather than floating on flat black. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,color-mix(in_srgb,var(--highlight)_14%,transparent),transparent_42%)] transition-colors duration-700" />
      <Globe />
      {/* [Agent] Cinematic scrims: the chrome stays legible over a flat map as well as over space. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-space/80 to-transparent transition-colors duration-700" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-space/80 to-transparent transition-colors duration-700" />
      <Header />
      <Search />
      <EventPanel />
      <Timeline />
      <Tour />
    </main>
  )
}
