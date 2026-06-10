import { supabase } from './supabase'

export type PingType = 'punch_in' | 'punch_out' | 'new_entry'

export interface Coords {
  lat: number
  lng: number
  accuracy?: number
}

// Read a fresh GPS fix. Resolves to null if geolocation is unavailable,
// denied, or times out — callers stay non-blocking.
export function getPosition(timeout = 8000): Promise<Coords | null> {
  return new Promise(resolve => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    )
  })
}

// Capture (or reuse) a GPS fix and store it as a location ping for history,
// then refresh the user's last-known location. Never throws.
export async function recordPing(
  userId: string,
  type: PingType,
  customerId?: string | null,
  coords?: Coords | null,
): Promise<Coords | null> {
  try {
    const c = coords ?? (await getPosition())
    if (!c) return null
    await supabase.from('location_pings').insert({
      user_id: userId,
      type,
      customer_id: customerId ?? null,
      lat: c.lat,
      lng: c.lng,
      accuracy: c.accuracy ?? null,
    } as any)
    await supabase
      .from('users')
      .update({ last_lat: c.lat, last_lng: c.lng, last_seen: new Date().toISOString() } as any)
      .eq('id', userId)
    return c
  } catch {
    return null
  }
}

// Current geolocation permission state, when the Permissions API exists.
export async function getGeoPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unsupported'> {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions) return 'unsupported'
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
    return status.state as 'granted' | 'denied' | 'prompt'
  } catch {
    return 'unsupported'
  }
}

// Distance in metres between two lat/lng points (haversine).
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
