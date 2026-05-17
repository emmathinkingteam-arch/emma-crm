'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Loader2, Phone, Check, X, AlertCircle, Save } from 'lucide-react'
import { ROLE_LABELS } from '@/lib/utils'

interface WorkerRow {
    id: string
    full_name: string
    username: string
    role: string
    phone_number: string | null
    sms_enabled: boolean
}

interface EditState {
    phone_number: string
    sms_enabled: boolean
    saving: boolean
    savedAt?: number
}

const ROLE_COLORS: Record<string, string> = {
    admin: 'bg-gray-100 text-gray-600',
    crm_agent: 'bg-green-50 text-green-700',
    back_office: 'bg-blue-50 text-blue-700',
    counselor: 'bg-purple-50 text-purple-700',
    manager: 'bg-amber-50 text-amber-700',
    designer: 'bg-pink-50 text-pink-700',
}

export default function WorkerPhonesPage() {
    const [workers, setWorkers] = useState<WorkerRow[]>([])
    const [edits, setEdits] = useState<Record<string, EditState>>({})
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        load()
    }, [])

    async function load() {
        setLoading(true)
        const { data, error } = await supabase
            .from('users')
            .select('id, full_name, username, role, phone_number, sms_enabled')
            .eq('is_active', true)
            .order('role')

        if (error) {
            console.error('Failed to load workers:', error)
        }

        if (data) {
            const rows = data as WorkerRow[]
            setWorkers(rows)
            const initial: Record<string, EditState> = {}
            rows.forEach((w) => {
                initial[w.id] = {
                    phone_number: w.phone_number ?? '',
                    sms_enabled: w.sms_enabled ?? true,
                    saving: false,
                }
            })
            setEdits(initial)
        }
        setLoading(false)
    }

    function isDirty(id: string): boolean {
        const w = workers.find((x) => x.id === id)
        const e = edits[id]
        if (!w || !e) return false
        return (
            (e.phone_number || '') !== (w.phone_number || '') ||
            e.sms_enabled !== (w.sms_enabled ?? true)
        )
    }

    async function saveRow(id: string) {
        const e = edits[id]
        if (!e) return

        setEdits((prev) => ({ ...prev, [id]: { ...prev[id], saving: true } }))

        const { error } = await supabase
            .from('users')
            .update({
                phone_number: e.phone_number.trim() || null,
                sms_enabled: e.sms_enabled,
            })
            .eq('id', id)

        if (error) {
            setEdits((prev) => ({ ...prev, [id]: { ...prev[id], saving: false } }))
            alert('Failed to save: ' + error.message)
            return
        }

        setWorkers((prev) =>
            prev.map((w) =>
                w.id === id
                    ? {
                        ...w,
                        phone_number: e.phone_number.trim() || null,
                        sms_enabled: e.sms_enabled,
                    }
                    : w
            )
        )
        setEdits((prev) => ({
            ...prev,
            [id]: { ...prev[id], saving: false, savedAt: Date.now() },
        }))

        setTimeout(() => {
            setEdits((prev) =>
                prev[id] ? { ...prev, [id]: { ...prev[id], savedAt: undefined } } : prev
            )
        }, 2000)
    }

    const missingPhones = workers.filter((w) => !w.phone_number).length

    return (
        <div className="p-6 max-w-5xl">
            <div className="mb-6">
                <h1 className="text-xl font-bold text-gray-800">Worker Phones</h1>
                <p className="text-xs text-gray-400 mt-1">
                    Manage phone numbers and SMS opt-in for each worker. Use international
                    format starting with country code (e.g. <span className="font-mono">94771234567</span>).
                </p>
            </div>

            {missingPhones > 0 && (
                <div className="bg-red-50 border border-red-100 rounded-2xl p-4 mb-5 flex items-center gap-3">
                    <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
                    <p className="text-xs text-red-700">
                        <span className="font-bold">{missingPhones}</span> active worker
                        {missingPhones === 1 ? ' has' : 's have'} no phone number — they
                        won&apos;t receive any SMS notifications.
                    </p>
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="animate-spin text-pink-600" size={28} />
                </div>
            ) : (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 border-b border-gray-100">
                            <tr>
                                {['Worker', 'Role', 'Phone Number', 'SMS', 'Save'].map((h) => (
                                    <th
                                        key={h}
                                        className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider"
                                    >
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {workers.map((w) => {
                                const e = edits[w.id]
                                if (!e) return null
                                const dirty = isDirty(w.id)
                                return (
                                    <tr key={w.id} className="hover:bg-pink-50/20">
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-xl bg-pink-100 flex items-center justify-center text-pink-600 font-bold text-xs">
                                                    {w.full_name?.[0] ?? '?'}
                                                </div>
                                                <div>
                                                    <p className="text-xs font-bold text-gray-800">
                                                        {w.full_name}
                                                    </p>
                                                    <p className="text-[9px] text-gray-400">
                                                        {w.username}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span
                                                className={`text-[9px] font-bold px-2 py-1 rounded-full ${ROLE_COLORS[w.role] ?? 'bg-gray-100 text-gray-500'
                                                    }`}
                                            >
                                                {ROLE_LABELS[w.role] ?? w.role}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <Phone
                                                    size={12}
                                                    className="text-gray-300 flex-shrink-0"
                                                />
                                                <input
                                                    type="tel"
                                                    value={e.phone_number}
                                                    onChange={(ev) =>
                                                        setEdits((prev) => ({
                                                            ...prev,
                                                            [w.id]: {
                                                                ...prev[w.id],
                                                                phone_number: ev.target.value,
                                                            },
                                                        }))
                                                    }
                                                    placeholder="94771234567"
                                                    className="text-xs font-mono text-gray-700 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-pink-300 w-40"
                                                />
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <button
                                                onClick={() =>
                                                    setEdits((prev) => ({
                                                        ...prev,
                                                        [w.id]: {
                                                            ...prev[w.id],
                                                            sms_enabled: !prev[w.id].sms_enabled,
                                                        },
                                                    }))
                                                }
                                                className={`text-[9px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 ${e.sms_enabled
                                                    ? 'bg-green-50 text-green-600'
                                                    : 'bg-gray-100 text-gray-400'
                                                    }`}
                                            >
                                                {e.sms_enabled ? (
                                                    <>
                                                        <Check size={10} /> Enabled
                                                    </>
                                                ) : (
                                                    <>
                                                        <X size={10} /> Disabled
                                                    </>
                                                )}
                                            </button>
                                        </td>
                                        <td className="px-4 py-3">
                                            {e.savedAt ? (
                                                <span className="text-[9px] font-bold text-green-600 flex items-center gap-1">
                                                    <Check size={10} /> Saved
                                                </span>
                                            ) : (
                                                <button
                                                    onClick={() => saveRow(w.id)}
                                                    disabled={!dirty || e.saving}
                                                    className={`text-[9px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 transition-all ${dirty
                                                        ? 'bg-pink-600 text-white hover:bg-pink-700'
                                                        : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                                                        }`}
                                                >
                                                    {e.saving ? (
                                                        <>
                                                            <Loader2
                                                                size={10}
                                                                className="animate-spin"
                                                            />{' '}
                                                            Saving
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Save size={10} /> Save
                                                        </>
                                                    )}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
