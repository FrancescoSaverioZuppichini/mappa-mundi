import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Viewport } from './placement'

// [Agent] The map's current view as placement sees it. Cheap tests run before map.project: the lon/lat bounds (measured east of the west edge modulo 360, so views across the antimeridian work), then on the globe the visible face, under ~72° from the centre. project() happily returns positions for the far side too, and labels near the limb would hang out in space.
// On the flat map, project() doesn't wrap either, so a longitude is first moved to the copy of the world nearest the centre. Otherwise, centred on Fiji, an event at -170° would be drawn 340° to the left, off screen.
export function viewportOf(map: MapLibreMap, globe: boolean): Viewport {
  const { clientWidth: width, clientHeight: height } = map.getContainer()
  const bounds = map.getBounds()
  const west = bounds.getWest()
  const lonSpan = bounds.getEast() - west
  const south = bounds.getSouth()
  const north = bounds.getNorth()
  const center = map.getCenter()
  const rad = Math.PI / 180
  const sinLat0 = Math.sin(center.lat * rad)
  const cosLat0 = Math.cos(center.lat * rad)

  return {
    width,
    height,
    zoom: map.getZoom(),
    locate(lon, lat) {
      if (lat < south || lat > north) return null
      if (lonSpan < 360 && (((lon - west) % 360) + 360) % 360 > lonSpan) return null
      if (globe && Math.sin(lat * rad) * sinLat0 + Math.cos(lat * rad) * cosLat0 * Math.cos((lon - center.lng) * rad) < 0.3) return null
      const p = map.project([lon + 360 * Math.round((center.lng - lon) / 360), lat])
      return p.x < 0 || p.y < 0 || p.x > width || p.y > height ? null : { x: p.x, y: p.y }
    },
  }
}
