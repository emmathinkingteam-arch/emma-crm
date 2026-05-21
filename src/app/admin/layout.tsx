'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import AdminSidebar from '@/components/admin/AdminSidebar'
import { Loader2 } from 'lucide-react'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { role, isLoading } = useAuthStore()

  useEffect(() => {
    if (!isLoading && role !== 'admin') {
      router.replace('/dashboard')
    }
  }, [role, isLoading])

  // Show a loader while auth is rehydrating OR while a non-admin is being
  // redirected away. We must NOT render the admin UI (sidebar/content) for
  // anyone who isn't a confirmed admin — not even for a single frame. The
  // server middleware already blocks non-admins, this is the client backstop.
  if (isLoading || role !== 'admin') {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-pink-600" size={28} />
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <AdminSidebar />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
