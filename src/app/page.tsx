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
    <div className="h-screen flex flex-col items-center justify-center bg-pink-50 gap-5">
      <div className="emma-pulse w-16 h-16 bg-pink-600 rounded-3xl flex items-center justify-center shadow-lg shadow-pink-200">
        <span className="text-white font-bold text-2xl">E</span>
      </div>
      <Loader2 className="animate-spin text-pink-300" size={22} />
    </div>
  )
}
