// [Agent] The handful of line icons the chrome uses, drawn at 17px on a 24-unit grid with a fine stroke in the current text colour.
const base = { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export const SearchIcon = () => (
  <svg {...base}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
)
export const LayersIcon = () => (
  <svg {...base}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></svg>
)
export const GlobeIcon = () => (
  <svg {...base}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" /></svg>
)
export const MapIcon = () => (
  <svg {...base}><path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Z" /><path d="M9 4v14M15 6v14" /></svg>
)
export const PlayIcon = () => (
  <svg {...base} fill="currentColor" stroke="none"><path d="M8 5.5v13a.7.7 0 0 0 1.05.6l10.4-6.5a.7.7 0 0 0 0-1.2L9.05 4.9A.7.7 0 0 0 8 5.5Z" /></svg>
)
export const PauseIcon = () => (
  <svg {...base} fill="currentColor" stroke="none"><rect x="6.5" y="5" width="4" height="14" rx="1" /><rect x="13.5" y="5" width="4" height="14" rx="1" /></svg>
)
export const CloseIcon = () => (
  <svg {...base}><path d="M6 6l12 12M18 6 6 18" /></svg>
)
export const ArrowIcon = () => (
  <svg {...base} width={14} height={14}><path d="M7 17 17 7M8 7h9v9" /></svg>
)
export const DiceIcon = () => (
  <svg {...base}>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <circle cx="9" cy="9" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="15" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="9" r="1" fill="currentColor" stroke="none" />
    <circle cx="9" cy="15" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
  </svg>
)
// [Agent] A compass needle: Play steering the camera for you.
export const ExploreIcon = () => (
  <svg {...base}><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></svg>
)
export const NextIcon = () => (
  <svg {...base}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
)
