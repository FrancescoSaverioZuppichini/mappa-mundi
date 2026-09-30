import type { Map as MapLibreMap, MapMouseEvent, Point } from 'maplibre-gl'

// [Agent] Hovering an event bubble: pointer cursor, a callback for the tooltip, and an eased 0→1 `hover` level in the feature state that the style turns into a swelling bubble plus a ring in the event's own colour.
// MapLibre doesn't animate feature-state changes, so a small tween steps each feature's level toward its target every frame, and only runs while something is still moving.
const DURATION_MS = 160

export function createHover(map: MapLibreMap, onChange: (hovered: { index: number; point: Point } | null) => void) {
  const levels = new Map<number, number>()
  let target: number | null = null
  let frame = 0
  let last = 0

  function tick(now: number) {
    const step = (now - last) / DURATION_MS
    last = now
    for (const [id, level] of levels) {
      const next = id === target ? Math.min(1, level + step) : Math.max(0, level - step)
      // [Agent] Ease-out on the way in and linear on the way out, so a hover snaps on and fades off.
      map.setFeatureState({ source: 'events', id }, { hover: id === target ? 1 - (1 - next) ** 2 : next })
      if (next === 0) levels.delete(id)
      else levels.set(id, next)
    }
    frame = [...levels].some(([id, level]) => level !== (id === target ? 1 : 0)) ? requestAnimationFrame(tick) : 0
  }

  function set(id: number | null, point?: Point) {
    if (id === target) {
      if (id !== null && point) onChange({ index: id, point })
      return
    }
    target = id
    if (id !== null && !levels.has(id)) levels.set(id, 0)
    map.getCanvas().style.cursor = id === null ? '' : 'pointer'
    onChange(id === null || !point ? null : { index: id, point })
    if (!frame) {
      last = performance.now()
      frame = requestAnimationFrame(tick)
    }
  }

  const onMove = (e: MapMouseEvent & { features?: { id?: string | number }[] }) => set(Number(e.features![0].id), e.point)
  const onLeave = () => set(null)
  // [Agent] A zoom or pan can carry the bubble out from under a still cursor, and MapLibre only fires mouseleave on mouse movement, so moving the camera clears the hover.
  const onCamera = () => target !== null && set(null)
  map.on('mousemove', 'event-bubbles', onMove)
  map.on('mouseleave', 'event-bubbles', onLeave)
  map.on('movestart', onCamera)

  return {
    // [Agent] Called after each placement pass: if the hovered event didn't make it back on screen, its tooltip goes too.
    keepIf(present: (id: number) => boolean) {
      if (target !== null && !present(target)) set(null)
    },
    destroy() {
      cancelAnimationFrame(frame)
      map.off('mousemove', 'event-bubbles', onMove)
      map.off('mouseleave', 'event-bubbles', onLeave)
      map.off('movestart', onCamera)
    },
  }
}
