'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import AdminSidebar from '@/components/admin/AdminSidebar'
import { Loader2 } from 'lucide-react'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { role, isLoading } = useAuthStore()

  // Who is allowed to render the admin shell:
  //   • admin      → everything under /admin
  //   • accountant → ONLY /admin/accounts/*
  const isAccountsArea = pathname.startsWith('/admin/accounts')
  const allowed =
    role === 'admin' || (role === 'accountant' && isAccountsArea)

  useEffect(() => {
    if (!isLoading && !allowed) {
      router.replace('/dashboard')
    }
  }, [allowed, isLoading, router])

  // Show a loader while auth is rehydrating OR while a disallowed user is
  // being redirected away. We must NOT render the admin UI for anyone who
  // isn't allowed — not even for a single frame. The server middleware
  // already blocks them; this is the client backstop.
  if (isLoading || !allowed) {
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
