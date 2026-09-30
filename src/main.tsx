// [Agent] Responsibility: boot. Loads the fonts and the app together and renders it, or says on the page that the data failed to load.

import 'maplibre-gl/dist/maplibre-gl.css'
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { EPOCHS } from './lib/epochs'

// [Agent] Boot: the epoch fonts and the app load together. Importing App loads hooks/useHistory.ts, which loads the data. The timeline canvas draws text in the epoch fonts, and canvas text never re-renders by itself once a web font arrives, so the fonts finish first. Fonts are best-effort (allSettled): a blocked font CDN costs typography, not the app. The data is not, and failing to load it says so on the page instead of leaving it blank.
const root = document.getElementById('root')!
try {
  const [, { App }] = await Promise.all([Promise.allSettled(EPOCHS.map(e => document.fonts.load(`16px ${e.font}`))), import('./components/App')])
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
} catch (err) {
  root.textContent = `History failed to load. ${err instanceof Error ? err.message : ''}`
}
