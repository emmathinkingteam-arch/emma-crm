'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Loader2 } from 'lucide-react'

export default function RootPage() {
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace('/dashboard')
      } else {
        router.replace('/auth/login')
      }
    })
  }, [router])

  return (
    <div className="h-screen flex items-center justify-center bg-white">
      <Loader2 className="animate-spin text-pink-600" size={32} />
    </div>
  )
}
