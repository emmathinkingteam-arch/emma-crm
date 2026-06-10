import InspectorBanner from '@/components/shared/InspectorBanner'
import LocationGate from '@/components/shared/LocationGate'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <LocationGate>
      {children}
      {/* Shown only when an admin is in inspector mode — floats above BottomNav */}
      <InspectorBanner />
    </LocationGate>
  )
}
