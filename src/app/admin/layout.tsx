'use client'

import AdminSidebar from '@/components/admin/AdminSidebar'
import { useAuthStore } from '@/store/auth'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { role } = useAuthStore()
  const isCeo = role === 'ceo'

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Hide sidebar on mobile for CEO — they use BottomNav instead */}
      <div className={isCeo ? 'hidden md:block' : 'block'}>
        <AdminSidebar />
      </div>
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}