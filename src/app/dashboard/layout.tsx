import InspectorBanner from '@/components/shared/InspectorBanner'
import LocationGate from '@/components/shared/LocationGate'
import UcpDock from '@/components/shared/UcpDock'
import CallbackRunner from '@/components/shared/CallbackRunner'

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
      {/* Fires promised call-backs when they come due, or as soon as the agent
          is back in the CRM if they were away. */}
      <CallbackRunner />
    </LocationGate>
  )
}
