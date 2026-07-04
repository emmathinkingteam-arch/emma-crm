'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Users, Lightbulb, Lock, Send, Loader2, MessagesSquare } from 'lucide-react'
import { fmtDate, fmtTime } from '@/lib/utils'

interface TeamMessage {
    id: string
    channel: 'group' | 'admin'
    thread_user_id: string | null
    sender_id: string
    sender_name: string
    sender_photo_url: string | null
    sender_role: string | null
    body: string
    created_at: string
}

interface Worker {
    id: string
    full_name: string
    role: string
    profile_photo_url: string | null
    is_active: boolean
}

// selected conversation: 'group' or a worker id (private idea thread)
type Selection = { type: 'group' } | { type: 'thread'; workerId: string }

function Avatar({ name, photo, size = 32 }: { name: string; photo: string | null; size?: number }) {
    return (
        <div
            className="rounded-full bg-pink-500 flex items-center justify-center overflow-hidden flex-shrink-0 border border-white shadow-sm"
            style={{ width: size, height: size }}
        >
            {photo
                ? <img src={photo} alt={name} className="w-full h-full object-cover" />
                : <span className="text-white font-bold" style={{ fontSize: size * 0.38 }}>{name?.[0] ?? '?'}</span>}
        </div>
    )
}

export default function AdminTeamChatPage() {
    const { user } = useAuthStore()
    const [messages, setMessages] = useState<TeamMessage[]>([])
    const [workers, setWorkers] = useState<Worker[]>([])
    const [loading, setLoading] = useState(true)
    const [selected, setSelected] = useState<Selection>({ type: 'group' })
    const [draft, setDraft] = useState('')
    const [sending, setSending] = useState(false)
    const bottomRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const load = async () => {
            const [msgs, users] = await Promise.all([
                supabase.from('team_messages').select('*').order('created_at', { ascending: true }),
                supabase.from('users').select('id, full_name, role, profile_photo_url, is_active')
                    .neq('role', 'admin').eq('is_active', true).order('full_name'),
            ])
            if (msgs.data) setMessages(msgs.data as TeamMessage[])
            if (users.data) setWorkers(users.data as Worker[])
            setLoading(false)
        }
        load()

        const sub = supabase.channel('admin-team-chat')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_messages' }, (payload) => {
                const msg = payload.new as TeamMessage
                setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg])
            }).subscribe()
        return () => { supabase.removeChannel(sub) }
    }, [])

    const groupMessages = useMemo(() => messages.filter(m => m.channel === 'group'), [messages])
    const threadMessages = useMemo(() => {
        const map: Record<string, TeamMessage[]> = {}
        for (const m of messages) {
            if (m.channel !== 'admin' || !m.thread_user_id) continue
            ;(map[m.thread_user_id] ||= []).push(m)
        }
        return map
    }, [messages])

    // private threads sorted by latest activity; workers with no messages last
    const threadList = useMemo(() => {
        return [...workers].sort((a, b) => {
            const la = threadMessages[a.id]?.at(-1)?.created_at ?? ''
            const lb = threadMessages[b.id]?.at(-1)?.created_at ?? ''
            return lb.localeCompare(la)
        })
    }, [workers, threadMessages])

    const activeMessages = selected.type === 'group'
        ? groupMessages
        : (threadMessages[selected.workerId] || [])

    const activeWorker = selected.type === 'thread'
        ? workers.find(w => w.id === selected.workerId)
        : null

    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [activeMessages.length, selected])

    const handleSend = async () => {
        if (!user || !draft.trim() || sending) return
        const body = draft.trim()
        setDraft('')
        setSending(true)
        const { data, error } = await supabase.from('team_messages').insert({
            channel: selected.type === 'group' ? 'group' : 'admin',
            thread_user_id: selected.type === 'thread' ? selected.workerId : null,
            sender_id: user.id,
            sender_name: user.full_name,
            sender_photo_url: user.profile_photo_url || null,
            sender_role: user.role,
            body,
        }).select().single()
        if (error) {
            alert('Message failed to send.\n' + error.message)
            setDraft(body)
        } else if (data) {
            setMessages(prev => prev.find(m => m.id === data.id) ? prev : [...prev, data as TeamMessage])
        }
        setSending(false)
    }

    if (loading) return (
        <div className="h-screen flex items-center justify-center">
            <Loader2 className="animate-spin text-pink-600" size={28} />
        </div>
    )

    return (
        <div className="h-screen flex flex-col p-6 max-w-6xl mx-auto">
            <div className="mb-4">
                <h1 className="text-xl font-bold text-gray-800">Team Chat</h1>
                <p className="text-xs text-gray-400 font-medium mt-0.5">
                    Group chat with everyone · Private idea threads from each worker
                </p>
            </div>

            <div className="flex-1 flex gap-4 min-h-0">

                {/* ── Conversation list ── */}
                <div className="w-72 flex-shrink-0 bg-white border border-gray-100 rounded-2xl overflow-y-auto">

                    {/* Group chat */}
                    <button
                        onClick={() => setSelected({ type: 'group' })}
                        className={`w-full flex items-center gap-3 px-3.5 py-3 text-left border-b border-gray-50 transition-colors ${selected.type === 'group' ? 'bg-pink-50' : 'hover:bg-gray-50'}`}
                    >
                        <div className="w-10 h-10 rounded-full bg-pink-600 flex items-center justify-center flex-shrink-0 shadow-md">
                            <Users size={17} className="text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-extrabold text-gray-800 truncate">Team Group Chat</p>
                                {groupMessages.at(-1) && (
                                    <span className="text-[8px] text-gray-300 font-bold flex-shrink-0">{fmtTime(groupMessages.at(-1)!.created_at)}</span>
                                )}
                            </div>
                            <p className="text-[10px] text-gray-400 font-medium truncate mt-0.5">
                                {groupMessages.at(-1)
                                    ? <><span className="font-bold text-gray-500">{groupMessages.at(-1)!.sender_name.split(' ')[0]}:</span> {groupMessages.at(-1)!.body}</>
                                    : 'Everyone can see this'}
                            </p>
                        </div>
                    </button>

                    {/* Private idea threads */}
                    <div className="px-3.5 pt-3 pb-1.5 flex items-center gap-1.5">
                        <Lightbulb size={11} className="text-purple-400" />
                        <p className="text-[9px] font-bold text-gray-300 uppercase tracking-widest">New Ideas · Private</p>
                    </div>
                    {threadList.map(w => {
                        const thread = threadMessages[w.id] || []
                        const last = thread.at(-1)
                        const active = selected.type === 'thread' && selected.workerId === w.id
                        return (
                            <button
                                key={w.id}
                                onClick={() => setSelected({ type: 'thread', workerId: w.id })}
                                className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors ${active ? 'bg-purple-50' : 'hover:bg-gray-50'}`}
                            >
                                <Avatar name={w.full_name} photo={w.profile_photo_url} size={36} />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="text-xs font-bold text-gray-700 truncate">{w.full_name}</p>
                                        {last && <span className="text-[8px] text-gray-300 font-bold flex-shrink-0">{fmtTime(last.created_at)}</span>}
                                    </div>
                                    <p className="text-[10px] text-gray-400 font-medium truncate mt-0.5">
                                        {last ? last.body : <span className="italic text-gray-300">No messages yet</span>}
                                    </p>
                                </div>
                            </button>
                        )
                    })}
                </div>

                {/* ── Chat pane ── */}
                <div className="flex-1 flex flex-col bg-pink-50/40 border border-gray-100 rounded-2xl overflow-hidden min-w-0">

                    {/* Header */}
                    <div className="bg-white px-4 py-3 flex items-center gap-2.5 border-b border-gray-100 flex-shrink-0">
                        {selected.type === 'group' ? (
                            <>
                                <div className="w-9 h-9 rounded-full bg-pink-600 flex items-center justify-center shadow-md">
                                    <Users size={15} className="text-white" />
                                </div>
                                <div>
                                    <p className="text-xs font-extrabold text-gray-800">Team Group Chat</p>
                                    <p className="text-[9px] text-gray-400 font-medium">Visible to the whole team</p>
                                </div>
                            </>
                        ) : activeWorker && (
                            <>
                                <Avatar name={activeWorker.full_name} photo={activeWorker.profile_photo_url} size={36} />
                                <div>
                                    <p className="text-xs font-extrabold text-gray-800 flex items-center gap-1.5">
                                        {activeWorker.full_name} <Lock size={9} className="text-purple-400" />
                                    </p>
                                    <p className="text-[9px] text-gray-400 font-medium capitalize">
                                        {activeWorker.role.replace('_', ' ')} · Private thread — only admins & {activeWorker.full_name.split(' ')[0]} can see this
                                    </p>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
                        {activeMessages.length === 0 && (
                            <div className="text-center pt-16">
                                <MessagesSquare size={32} className="text-gray-200 mx-auto mb-3" />
                                <p className="text-xs font-semibold text-gray-300">No messages yet</p>
                            </div>
                        )}
                        {activeMessages.map((m, i) => {
                            const mine = m.sender_id === user?.id
                            const prev = activeMessages[i - 1]
                            const newDay = !prev || fmtDate(prev.created_at) !== fmtDate(m.created_at)
                            const sameSenderAsPrev = !newDay && prev?.sender_id === m.sender_id
                            return (
                                <div key={m.id}>
                                    {newDay && (
                                        <div className="flex justify-center py-2">
                                            <span className="bg-white text-gray-400 text-[8px] font-bold uppercase tracking-wide px-3 py-1 rounded-full shadow-sm">
                                                {fmtDate(m.created_at)}
                                            </span>
                                        </div>
                                    )}
                                    <div className={`flex items-end gap-1.5 ${mine ? 'justify-end' : 'justify-start'} ${sameSenderAsPrev ? 'mt-0.5' : 'mt-2'}`}>
                                        {!mine && (
                                            sameSenderAsPrev
                                                ? <div className="w-[26px] flex-shrink-0" />
                                                : <Avatar name={m.sender_name} photo={m.sender_photo_url} size={26} />
                                        )}
                                        <div className={`max-w-[65%] px-3 py-2 shadow-sm ${mine
                                            ? 'bg-pink-600 text-white rounded-2xl rounded-br-md'
                                            : 'bg-white text-gray-700 rounded-2xl rounded-bl-md'}`}
                                        >
                                            {!mine && !sameSenderAsPrev && (
                                                <p className="text-[9px] font-extrabold mb-0.5 text-purple-600">{m.sender_name}</p>
                                            )}
                                            <p className="text-xs font-medium leading-relaxed whitespace-pre-wrap break-words">{m.body}</p>
                                            <p className={`text-[7px] font-semibold mt-1 text-right ${mine ? 'text-pink-200' : 'text-gray-300'}`}>
                                                {fmtTime(m.created_at)}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                        <div ref={bottomRef} />
                    </div>

                    {/* Composer */}
                    <div className="px-4 py-3 bg-white border-t border-gray-100 flex-shrink-0">
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={draft}
                                onChange={e => setDraft(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                                placeholder={selected.type === 'group' ? 'Message the whole team…' : `Reply privately to ${activeWorker?.full_name.split(' ')[0] ?? 'worker'}…`}
                                className="flex-1 bg-gray-50 border border-gray-200 rounded-full px-4 py-2.5 text-xs font-medium outline-none focus:border-pink-300"
                            />
                            <button
                                onClick={handleSend}
                                disabled={!draft.trim() || sending}
                                className="w-10 h-10 rounded-full bg-pink-600 text-white flex items-center justify-center shadow-md shadow-pink-200 disabled:opacity-40 active:scale-95 transition-transform flex-shrink-0"
                            >
                                {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
