'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { ArrowLeft, Users, Lightbulb, Lock, Send, Loader2 } from 'lucide-react'
import { fmtDate, fmtTime } from '@/lib/utils'
import { TeamMessage, markChannelRead } from '../chat-shared'

const CHANNEL_META = {
    group: {
        title: 'Team Group Chat',
        subtitle: 'Everyone at Emma Thinking',
        icon: Users,
        iconBg: 'bg-pink-600',
        empty: 'Say hi to the team! 👋',
    },
    admin: {
        title: 'New Ideas · Admin',
        subtitle: 'Private — only admins can see this',
        icon: Lightbulb,
        iconBg: 'bg-purple-500',
        empty: 'Share your ideas with admin — nobody else can see this chat 💡',
    },
} as const

function Avatar({ name, photo, size = 26 }: { name: string; photo: string | null; size?: number }) {
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

// consistent name colour per sender, WhatsApp-style
const NAME_COLORS = ['text-pink-600', 'text-purple-600', 'text-blue-600', 'text-emerald-600', 'text-orange-500', 'text-rose-500', 'text-teal-600', 'text-indigo-600']
function nameColor(id: string): string {
    let h = 0
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
    return NAME_COLORS[h % NAME_COLORS.length]
}

export default function ChatRoomPage() {
    const { channel } = useParams<{ channel: string }>()
    const router = useRouter()
    const { user } = useAuthStore()
    const [messages, setMessages] = useState<TeamMessage[]>([])
    const [loading, setLoading] = useState(true)
    const [draft, setDraft] = useState('')
    const [sending, setSending] = useState(false)
    const bottomRef = useRef<HTMLDivElement>(null)

    const meta = CHANNEL_META[channel as keyof typeof CHANNEL_META]
    const isAdmin = channel === 'admin'

    const loadMessages = useCallback(async () => {
        if (!user) return
        let q = supabase.from('team_messages').select('*').eq('channel', channel).order('created_at', { ascending: true })
        if (isAdmin) q = q.eq('thread_user_id', user.id)
        const { data } = await q
        if (data) setMessages(data as TeamMessage[])
        setLoading(false)
        markChannelRead(channel)
    }, [user, channel, isAdmin])

    useEffect(() => { loadMessages() }, [loadMessages])

    // Realtime — RLS already hides other workers' private threads
    useEffect(() => {
        if (!user) return
        const sub = supabase.channel(`team-chat-${channel}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_messages' }, (payload) => {
                const msg = payload.new as TeamMessage
                if (msg.channel !== channel) return
                if (isAdmin && msg.thread_user_id !== user.id) return
                setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg])
                markChannelRead(channel)
            }).subscribe()
        return () => { supabase.removeChannel(sub) }
    }, [user, channel, isAdmin])

    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

    const handleSend = async () => {
        if (!user || !draft.trim() || sending) return
        const body = draft.trim()
        setDraft('')
        setSending(true)
        const { data, error } = await supabase.from('team_messages').insert({
            channel,
            thread_user_id: isAdmin ? user.id : null,
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

    if (!meta) {
        router.replace('/dashboard/chat')
        return null
    }

    if (loading) return (
        <div className="h-screen flex items-center justify-center bg-white">
            <Loader2 className="animate-spin text-pink-600" size={28} />
        </div>
    )

    const HeaderIcon = meta.icon

    return (
        <div className="h-[100dvh] flex flex-col bg-pink-50/40 overflow-hidden max-w-[500px] mx-auto">

            {/* ── Header ── */}
            <div className="bg-pink-100 px-3 py-3 flex items-center gap-2.5 rounded-b-[24px] shadow-sm z-10 flex-shrink-0">
                <button
                    onClick={() => router.push('/dashboard/chat')}
                    className="w-8 h-8 rounded-full bg-white/70 flex items-center justify-center text-gray-600 active:scale-95 transition-transform flex-shrink-0"
                >
                    <ArrowLeft size={16} />
                </button>
                <div className={`w-9 h-9 rounded-full ${meta.iconBg} flex items-center justify-center flex-shrink-0 shadow-md`}>
                    <HeaderIcon size={16} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-extrabold text-gray-800 flex items-center gap-1.5 truncate">
                        {meta.title}
                        {isAdmin && <Lock size={9} className="text-purple-400" />}
                    </p>
                    <p className="text-[9px] text-gray-500 font-medium truncate">{meta.subtitle}</p>
                </div>
            </div>

            {/* ── Messages ── */}
            <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
                {messages.length === 0 && (
                    <div className="text-center pt-16">
                        <div className={`w-14 h-14 rounded-full ${meta.iconBg} opacity-20 flex items-center justify-center mx-auto mb-3`}>
                            <HeaderIcon size={24} className="text-white" />
                        </div>
                        <p className="text-xs font-semibold text-gray-300 px-10 leading-relaxed">{meta.empty}</p>
                    </div>
                )}

                {messages.map((m, i) => {
                    const mine = m.sender_id === user?.id
                    const prev = messages[i - 1]
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
                                        : <Avatar name={m.sender_name} photo={m.sender_photo_url} />
                                )}
                                <div className={`max-w-[75%] px-3 py-2 shadow-sm ${mine
                                    ? 'bg-pink-600 text-white rounded-2xl rounded-br-md'
                                    : 'bg-white text-gray-700 rounded-2xl rounded-bl-md'}`}
                                >
                                    {!mine && !sameSenderAsPrev && (
                                        <p className={`text-[9px] font-extrabold mb-0.5 ${nameColor(m.sender_id)}`}>{m.sender_name}</p>
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

            {/* ── Composer ── */}
            <div className="px-3 pb-4 pt-2 bg-transparent flex-shrink-0">
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                        placeholder={isAdmin ? 'Message admin privately…' : 'Message the team…'}
                        className="flex-1 bg-white border-2 border-pink-100 rounded-full px-4 py-3 text-xs font-medium outline-none focus:border-pink-300 shadow-sm"
                    />
                    <button
                        onClick={handleSend}
                        disabled={!draft.trim() || sending}
                        className="w-11 h-11 rounded-full bg-pink-600 text-white flex items-center justify-center shadow-md shadow-pink-200 disabled:opacity-40 active:scale-95 transition-transform flex-shrink-0"
                    >
                        {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    </button>
                </div>
            </div>
        </div>
    )
}
