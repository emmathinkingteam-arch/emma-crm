import InspectorBanner from '@/components/shared/InspectorBanner'
import LocationGate from '@/components/shared/LocationGate'
import UcpDock from '@/components/shared/UcpDock'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <LocationGate>
      {children}
      {/* Shown only when an admin is in inspector mode — floats above BottomNav */}
      <InspectorBanner />
      {/* The softphone. Mounted here, NOT in a page: a page unmounts on
          navigation, which would drop a live call. Renders nothing for workers
          without a UCP account. */}
      <UcpDock />
    </LocationGate>
  )
}
