'use client'

// ============================================================================
// /admin/inspector/sessions/[id] — deep view of how much time a worker spends
// in the system. Shows hours per day (last 30 days) and which pages they sit
// on the most, for a chosen day or across the whole period.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { fmtDuration } from '@/lib/utils'
import { ArrowLeft, Clock, Loader2, CalendarDays, Layers } from 'lucide-react'

interface SessionRow { id: string; day: string; started_at: string; last_seen: string; seconds: number }
interface PageRow { day: string; path: string; seconds: number }

// Friendly label for a route so the admin reads "Clients" not "/dashboard/customers".
function prettyPath(path: string): string {
    const map: Record<string, string> = {
        '/dashboard': 'Home (Dashboard)',
        '/entry': 'New Entry',
        '/entry/process': 'Entry — Save Job',
        '/dashboard/customers': 'Clients',
        '/dashboard/wallet': 'Wallet',
        '/dashboard/profile': 'Profile / Punch',
        '/dashboard/complaints': 'Complaints',
        '/dashboard/calendar': 'Calendar / Plan',
        '/dashboard/tasks': 'Tasks',
        '/dashboard/team': 'Team Overview',
        '/dashboard/attendance-sheet': 'Attendance Sheet',
        '/dashboard/legacy-history': 'Search History',
    }
    if (map[path]) return map[path]
    if (path.startsWith('/dashboard/customers/')) return 'Client — detail'
    if (path.startsWith('/dashboard/leads/')) return 'Lead — call'
    if (path.startsWith('/dashboard/second-post/')) return '2nd Post'
    if (path.startsWith('/admin/')) return path.replace('/admin/', 'Admin · ')
    return path
}

function dayLabel(d: string) {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function SessionDetailPage() {
    const { id } = useParams<{ id: string }>()
    const [name, setName] = useState('')
    const [sessions, setSessions] = useState<SessionRow[]>([])
    const [pages, setPages] = useState<PageRow[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedDay, setSelectedDay] = useState<string>('all')

    useEffect(() => {
        if (!id) return
        const since = new Date()
        since.setDate(since.getDate() - 30)
        const sinceStr = since.toISOString().split('T')[0]

        Promise.all([
            supabase.from('users').select('full_name').eq('id', id).single(),
            supabase.from('work_sessions').select('id, day, started_at, last_seen, seconds')
                .eq('user_id', id).gte('day', sinceStr).order('day', { ascending: false }),
            supabase.from('page_durations').select('day, path, seconds')
                .eq('user_id', id).gte('day', sinceStr),
        ]).then(([u, s, p]) => {
            if (u.data) setName((u.data as any).full_name)
            setSessions((s.data as SessionRow[]) || [])
            setPages((p.data as PageRow[]) || [])
            setLoading(false)
        })
    }, [id])

    // Hours per day (sum of session seconds).
    const perDay = useMemo(() => {
        const map: Record<string, number> = {}
        for (const s of sessions) map[s.day] = (map[s.day] || 0) + Number(s.seconds || 0)
        return Object.entries(map)
            .map(([day, seconds]) => ({ day, seconds }))
            .sort((a, b) => b.day.localeCompare(a.day))
    }, [sessions])

    const maxDaySeconds = Math.max(1, ...perDay.map(d => d.seconds))
    const totalSeconds = perDay.reduce((s, d) => s + d.seconds, 0)

    // Page breakdown for the selected day (or all days).
    const pageBreakdown = useMemo(() => {
        const map: Record<string, number> = {}
        for (const p of pages) {
            if (selectedDay !== 'all' && p.day !== selectedDay) continue
            map[p.path] = (map[p.path] || 0) + Number(p.seconds || 0)
        }
        return Object.entries(map)
            .map(([path, seconds]) => ({ path, seconds }))
            .sort((a, b) => b.seconds - a.seconds)
    }, [pages, selectedDay])

    const maxPageSeconds = Math.max(1, ...pageBreakdown.map(p => p.seconds))

    if (loading) {
        return <div className="flex justify-center py-24"><Loader2 className="animate-spin text-pink-600" size={26} /></div>
    }

    return (
        <div className="p-6 max-w-3xl">
            <Link href="/admin/inspector" className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800 mb-5">
                <ArrowLeft size={14} /> Back to Inspector
            </Link>

            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                    <Clock size={18} className="text-emerald-600" />
                </div>
                <div>
                    <h1 className="text-xl font-bold text-gray-800">{name || 'Worker'} — Time in system</h1>
                    <p className="text-[11px] text-gray-400 font-medium">
                        Last 30 days · {fmtDuration(totalSeconds)} total active time
                    </p>
                </div>
            </div>

            {/* Hours per day */}
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 mb-6">
                <p className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-4">
                    <CalendarDays size={13} className="text-pink-500" /> Hours per day
                </p>
                {perDay.length === 0 ? (
                    <p className="text-xs text-gray-400 font-medium py-6 text-center">No session activity recorded yet.</p>
                ) : (
                    <div className="space-y-2.5">
                        {perDay.map(d => (
                            <button
                                key={d.day}
                                onClick={() => setSelectedDay(selectedDay === d.day ? 'all' : d.day)}
                                className="w-full flex items-center gap-3 group"
                            >
                                <span className={`w-28 text-left text-[11px] font-semibold flex-shrink-0 ${selectedDay === d.day ? 'text-pink-600' : 'text-gray-500'}`}>
                                    {dayLabel(d.day)}
                                </span>
                                <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all ${selectedDay === d.day ? 'bg-pink-600' : 'bg-pink-400 group-hover:bg-pink-500'}`}
                                        style={{ width: `${Math.max(4, (d.seconds / maxDaySeconds) * 100)}%` }}
                                    />
                                </div>
                                <span className="w-16 text-right text-[11px] font-bold text-gray-700 flex-shrink-0">
                                    {fmtDuration(d.seconds)}
                                </span>
                            </button>
                        ))}
                        <p className="text-[9px] text-gray-400 font-medium pt-1">Tap a day to see which pages they used that day.</p>
                    </div>
                )}
            </div>

            {/* Page breakdown */}
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
                <div className="flex items-center justify-between mb-4">
                    <p className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500 uppercase tracking-wide">
                        <Layers size={13} className="text-pink-500" /> Where they spend time
                    </p>
                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">
                        {selectedDay === 'all' ? 'All 30 days' : dayLabel(selectedDay)}
                    </span>
                </div>
                {pageBreakdown.length === 0 ? (
                    <p className="text-xs text-gray-400 font-medium py-6 text-center">No page activity for this selection.</p>
                ) : (
                    <div className="space-y-2.5">
                        {pageBreakdown.map(p => (
                            <div key={p.path} className="flex items-center gap-3">
                                <span className="w-40 text-left text-[11px] font-semibold text-gray-600 truncate flex-shrink-0" title={p.path}>
                                    {prettyPath(p.path)}
                                </span>
                                <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                                    <div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.max(4, (p.seconds / maxPageSeconds) * 100)}%` }} />
                                </div>
                                <span className="w-16 text-right text-[11px] font-bold text-gray-700 flex-shrink-0">
                                    {fmtDuration(p.seconds)}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
