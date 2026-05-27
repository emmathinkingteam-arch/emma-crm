'use client'

// ============================================================================
// /admin/inspector — click any worker to preview their dashboard exactly as
// they see it. An amber banner floats on screen the whole time; tap Exit to
// restore the admin session and come back here.
// ============================================================================

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { ROLE_LABELS } from '@/lib/utils'
import { type User } from '@/types'
import {
    Eye,
    Loader2,
    Search,
    UserCircle2,
    Wifi,
} from 'lucide-react'

const ROLE_ORDER: Record<string, number> = {
    crm_agent: 0,
    back_office: 1,
    counselor: 2,
    manager: 3,
    designer: 4,
}

const ROLE_COLORS: Record<string, string> = {
    crm_agent: 'bg-blue-50 text-blue-600',
    back_office: 'bg-purple-50 text-purple-600',
    counselor: 'bg-green-50 text-green-600',
    manager: 'bg-pink-50 text-pink-600',
    designer: 'bg-amber-50 text-amber-600',
}

export default function InspectorPage() {
    const router = useRouter()
    const { startInspect } = useAuthStore()
    const [workers, setWorkers] = useState<User[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')

    useEffect(() => {
        supabase
            .from('users')
            .select('*')
            .eq('is_active', true)
            .not('role', 'in', '(admin,accountant)')
            .then(({ data }) => {
                const sorted = ((data as User[]) || []).sort(
                    (a, b) =>
                        (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) ||
                        a.full_name.localeCompare(b.full_name)
                )
                setWorkers(sorted)
                setLoading(false)
            })
    }, [])

    const filtered = workers.filter(
        (w) =>
            w.full_name.toLowerCase().includes(search.toLowerCase()) ||
            w.username.toLowerCase().includes(search.toLowerCase()) ||
            (ROLE_LABELS[w.role] ?? w.role).toLowerCase().includes(search.toLowerCase())
    )

    function handleInspect(worker: User) {
        startInspect(worker)
        router.push('/dashboard')
    }

    return (
        <div className="p-6 max-w-4xl">
            {/* Header */}
            <div className="mb-6 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
                    <Eye size={16} className="text-amber-600" />
                </div>
                <div>
                    <h1 className="text-xl font-bold text-gray-800">Inspector</h1>
                    <p className="text-[10px] text-gray-400 font-medium">
                        Click any worker to view their dashboard exactly as they see it
                    </p>
                </div>
            </div>

            {/* How it works */}
            <div className="bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3 mb-6 flex items-start gap-3">
                <Wifi size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 font-medium leading-relaxed">
                    You will be taken to the worker&apos;s dashboard in <strong>inspector mode</strong>.
                    An amber banner stays visible at all times — tap <strong>Exit</strong> to return here
                    and restore your admin session.
                </p>
            </div>

            {/* Search */}
            <div className="relative mb-5">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300" />
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name or role…"
                    className="w-full bg-white border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm font-medium outline-none focus:border-pink-300 shadow-sm"
                />
            </div>

            {/* Workers grid */}
            {loading ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="animate-spin text-pink-600" size={24} />
                </div>
            ) : filtered.length === 0 ? (
                <div className="bg-gray-50 rounded-2xl p-10 text-center text-xs font-semibold text-gray-400">
                    No workers found
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {filtered.map((worker) => {
                        const roleLabel = ROLE_LABELS[worker.role] ?? worker.role
                        const roleColor = ROLE_COLORS[worker.role] ?? 'bg-gray-100 text-gray-500'

                        return (
                            <button
                                key={worker.id}
                                onClick={() => handleInspect(worker)}
                                className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-amber-200 active:scale-95 transition-all text-left group"
                            >
                                {/* Avatar */}
                                <div className="flex items-center justify-between mb-3">
                                    {worker.profile_photo_url ? (
                                        <img
                                            src={worker.profile_photo_url}
                                            alt={worker.full_name}
                                            className="w-11 h-11 rounded-xl object-cover border border-gray-100"
                                        />
                                    ) : (
                                        <div className="w-11 h-11 rounded-xl bg-gray-100 flex items-center justify-center">
                                            <UserCircle2 size={24} className="text-gray-300" />
                                        </div>
                                    )}
                                    <div className="w-7 h-7 rounded-full bg-gray-50 group-hover:bg-amber-500 flex items-center justify-center transition-colors">
                                        <Eye size={13} className="text-gray-300 group-hover:text-white transition-colors" />
                                    </div>
                                </div>

                                {/* Name + role */}
                                <p className="text-sm font-bold text-gray-800 truncate">
                                    {worker.full_name}
                                </p>
                                <p className="text-[10px] text-gray-400 font-medium truncate mb-2">
                                    {worker.username}
                                </p>
                                <span className={`text-[9px] font-bold px-2 py-1 rounded-full ${roleColor}`}>
                                    {roleLabel}
                                </span>
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}