'use client'

// ============================================================================
// InspectorBanner — floats above the BottomNav while an admin is inspecting
// a worker's dashboard. Shows the worker's name + role and provides a one-tap
// exit that restores the admin's session and returns to the inspector page.
// ============================================================================

import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { ROLE_LABELS } from '@/lib/utils'
import { Eye, X } from 'lucide-react'

export default function InspectorBanner() {
    const router = useRouter()
    const { inspecting, stopInspect } = useAuthStore()

    if (!inspecting) return null

    function handleExit() {
        stopInspect()
        router.push('/admin/inspector')
    }

    const roleLabel = ROLE_LABELS[inspecting.role] ?? inspecting.role

    return (
        // Sits just above the BottomNav (bottom-[72px]) so it never overlaps
        // page content, but is always reachable without scrolling.
        <div className="fixed bottom-[72px] left-1/2 -translate-x-1/2 z-50 w-full max-w-[500px] px-4 pointer-events-none">
            <div
                className="flex items-center justify-between gap-3 bg-amber-500 text-white rounded-2xl px-4 py-2.5 shadow-xl shadow-amber-200/60 pointer-events-auto"
            >
                {/* Left — identity */}
                <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                        <Eye size={13} />
                    </div>
                    {inspecting.profile_photo_url ? (
                        <img
                            src={inspecting.profile_photo_url}
                            alt={inspecting.full_name}
                            className="w-6 h-6 rounded-full object-cover border border-white/40 flex-shrink-0"
                        />
                    ) : (
                        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0 text-[10px] font-bold">
                            {inspecting.full_name.charAt(0)}
                        </div>
                    )}
                    <div className="min-w-0">
                        <p className="text-xs font-bold truncate leading-tight">
                            {inspecting.full_name}
                        </p>
                        <p className="text-[9px] font-semibold text-amber-100 leading-tight">
                            Inspector mode · {roleLabel}
                        </p>
                    </div>
                </div>

                {/* Right — exit */}
                <button
                    onClick={handleExit}
                    className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 active:scale-95 transition-all rounded-xl px-3 py-1.5 text-[11px] font-bold flex-shrink-0"
                >
                    <X size={12} /> Exit
                </button>
            </div>
        </div>
    )
}