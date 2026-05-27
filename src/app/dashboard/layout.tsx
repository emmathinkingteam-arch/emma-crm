import InspectorBanner from '@/components/shared/InspectorBanner'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* Shown only when an admin is in inspector mode — floats above BottomNav */}
      <InspectorBanner />
    </>
  )
}