'use client'

// ============================================================================
// /dashboard/low-interest — the full Low Interest Alerts list (Back Office)
// ============================================================================
// The dashboard shows only the worst few low-interest posts and rolls the rest
// into a "+N more" line. That line lands here: the same LowInterestAlert
// component with the cap lifted, so Back Office gets every flagged post in one
// scrollable list (admins have the equivalent on /admin/alerts).
// ============================================================================

import Link from 'next/link'
import { ChevronLeft, Heart } from 'lucide-react'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import LowInterestAlert from '@/components/shared/LowInterestAlert'

export default function LowInterestPage() {
  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <TopNav />
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28">

        <Link href="/dashboard" className="inline-flex items-center gap-1 text-[11px] font-bold text-gray-400 hover:text-gray-600 mb-3">
          <ChevronLeft size={13} /> Dashboard
        </Link>

        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-xl bg-pink-50 flex items-center justify-center flex-shrink-0">
            <Heart size={15} className="text-pink-500" fill="currentColor" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-extrabold text-gray-800 leading-none">Low Interest Alerts</h1>
            <p className="text-[10px] text-gray-400 font-semibold mt-1">
              Active posts 7+ days old with fewer than 8 live interests received
              (rejected and withdrawn don&apos;t count)
            </p>
          </div>
        </div>

        {/* Full list — no cap, no "+more" roll-up (this IS the destination page) */}
        <LowInterestAlert limit={1000} viewAllHref="/dashboard/low-interest" />

      </div>
      <BottomNav />
    </div>
  )
}
