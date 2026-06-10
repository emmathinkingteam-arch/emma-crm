import LocationGate from '@/components/shared/LocationGate'

// New entries must capture the worker's location, so the entry flow is gated
// the same way the dashboard is.
export default function EntryLayout({ children }: { children: React.ReactNode }) {
  return <LocationGate>{children}</LocationGate>
}
