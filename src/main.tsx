import 'maplibre-gl/dist/maplibre-gl.css'
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { EPOCHS } from './model/epochs'
import { loadEvents } from './model/events'
import { keepSelectionInTime } from './state/navigation'
import { restoreFromUrl, syncToUrl } from './state/permalink'
import { App } from './ui/App'

// [Agent] Boot: load the events and every epoch font, restore the view from the URL, then render. The timeline canvas draws text in the epoch fonts, and canvas text never re-renders by itself once a web font arrives, so the fonts load before the first draw.
// Fonts are best-effort (allSettled): a blocked font CDN costs typography, not the app. The data is not, and failing to load it says so on the page instead of leaving it blank.
const root = document.getElementById('root')!
try {
  const [events] = await Promise.all([loadEvents(), Promise.allSettled(EPOCHS.map(e => document.fonts.load(`16px ${e.font}`)))])
  restoreFromUrl(events)
  syncToUrl(events)
  keepSelectionInTime(events)
  createRoot(root).render(
    <StrictMode>
      <App events={events} />
    </StrictMode>,
  )
} catch (err) {
  root.textContent = `History failed to load. ${err instanceof Error ? err.message : ''}`
}
