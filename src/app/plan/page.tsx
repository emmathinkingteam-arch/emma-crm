'use client'
// Plan page IS the FR calendar — redirect to the calendar page
// which has the full FR PLAN grid implementation
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export default function PlanPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/dashboard/calendar')
  }, [router])
  return (
    <div className="h-screen flex items-center justify-center bg-white">
      <Loader2 className="animate-spin text-pink-600" size={24} />
    </div>
  )
}
