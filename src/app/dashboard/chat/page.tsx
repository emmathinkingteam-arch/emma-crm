'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import TopNav from '@/components/shared/TopNav'
import BottomNav from '@/components/shared/BottomNav'
import { Users, Lightbulb, MessageSquareWarning, Lock, ChevronRight, Loader2 } from 'lucide-react'
import { fmtDate, fmtTime } from '@/lib/utils'
import { TeamMessage, lastReadKey } from './chat-shared'

interface Preview {
    body: string
    sender_name: string
    created_at: string
    unread: number
}

// last message + unread count for one channel
function buildPreview(messages: TeamMessage[], myId: string, readKey: string): Preview | null {
    if (messages.length === 0) return null
    const last = messages[messages.length - 1]
    const lastRead = Number(localStorage.getItem(readKey) || 0)
    const unread = messages.filter(m =>
        m.sender_id !== myId && new Date(m.created_at).getTime() > lastRead
    ).length
    return { body: last.body, sender_name: last.sender_name, created_at: last.created_at, unread }
}

function previewTime(ts: string): string {
    const d = new Date(ts)
    const today = new Date()
    return d.toDateString() === today.toDateString() ? fmtTime(ts) : fmtDate(ts)
}

export default function ChatListPage() {
    const { user } = useAuthStore()
    const router = useRouter()
    const [loading, setLoading] = useState(true)
    const [groupPreview, setGroupPreview] = useState<Preview | null>(null)
    const [adminPreview, setAdminPreview] = useState<Preview | null>(null)

    useEffect(() => {
        if (!user) return
        const load = async () => {
            const [group, admin] = await Promise.all([
                supabase.from('team_messages').select('*')
                    .eq('channel', 'group').order('created_at', { ascending: true }),
                supabase.from('team_messages').select('*')
                    .eq('channel', 'admin').eq('thread_user_id', user.id)
                    .order('created_at', { ascending: true }),
            ])
            setGroupPreview(buildPreview((group.data || []) as TeamMessage[], user.id, lastReadKey('group')))
            setAdminPreview(buildPreview((admin.data || []) as TeamMessage[], user.id, lastReadKey('admin')))
            setLoading(false)
        }
        load()

        // keep previews fresh while sitting on the list
        const sub = supabase.channel('chat-list')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_messages' }, () => load())
            .subscribe()
        return () => { supabase.removeChannel(sub) }
    }, [user])

    if (loading) return (
        <div className="h-screen flex items-center justify-center bg-white">
            <Loader2 className="animate-spin text-pink-600" size={28} />
        </div>
    )

    const chats = [
        {
            key: 'group',
            title: 'Team Group Chat',
            subtitle: 'Everyone at Emma Thinking',
            icon: Users,
            iconBg: 'bg-pink-600',
            preview: groupPreview,
            onClick: () => router.push('/dashboard/chat/group'),
            lock: false,
        },
        {
            key: 'admin',
            title: 'New Ideas · Admin',
            subtitle: 'Private — only admins can see this',
            icon: Lightbulb,
            iconBg: 'bg-purple-500',
            preview: adminPreview,
            onClick: () => router.push('/dashboard/chat/admin'),
            lock: true,
        },
    ]

    return (
        <div className="h-screen flex flex-col bg-white overflow-hidden">
            <TopNav />
            <div className="flex-1 overflow-y-auto pb-28">

                {/* Header */}
                <div className="bg-pink-50 px-4 pt-4 pb-5 rounded-b-[28px]">
                    <h1 className="text-base font-extrabold text-gray-800">Team Chat</h1>
                    <p className="text-[10px] text-gray-500 font-medium mt-0.5">
                        Talk with the team · Share ideas privately with admin
                    </p>
                </div>

                <div className="px-4 py-4 space-y-2.5">
                    {chats.map(({ key, title, subtitle, icon: Icon, iconBg, preview, onClick, lock }) => (
                        <button
                            key={key}
                            onClick={onClick}
                            className="w-full flex items-center gap-3 bg-white border border-gray-100 rounded-2xl px-3.5 py-3.5 text-left shadow-sm active:scale-[0.98] transition-transform"
                        >
                            <div className={`w-12 h-12 rounded-full ${iconBg} flex items-center justify-center flex-shrink-0 shadow-md`}>
                                <Icon size={20} className="text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-extrabold text-gray-800 flex items-center gap-1.5 truncate">
                                        {title}
                                        {lock && <Lock size={9} className="text-purple-400 flex-shrink-0" />}
                                    </p>
                                    {preview && (
                                        <span className={`text-[8px] font-bold flex-shrink-0 ${preview.unread > 0 ? 'text-pink-600' : 'text-gray-300'}`}>
                                            {previewTime(preview.created_at)}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center justify-between gap-2 mt-0.5">
                                    <p className="text-[10px] text-gray-400 font-medium truncate">
                                        {preview
                                            ? <><span className="font-bold text-gray-500">{preview.sender_name.split(' ')[0]}:</span> {preview.body}</>
                                            : subtitle}
                                    </p>
                                    {preview && preview.unread > 0 && (
                                        <span className="min-w-[18px] h-[18px] px-1 bg-pink-600 rounded-full text-white text-[8px] font-bold flex items-center justify-center flex-shrink-0">
                                            {preview.unread > 99 ? '99+' : preview.unread}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </button>
                    ))}

                    {/* Complaints — opens the complaint page */}
                    <button
                        onClick={() => router.push('/dashboard/complaints')}
                        className="w-full flex items-center gap-3 bg-red-50/60 border border-red-100 rounded-2xl px-3.5 py-3.5 text-left active:scale-[0.98] transition-transform"
                    >
                        <div className="w-12 h-12 rounded-full bg-red-400 flex items-center justify-center flex-shrink-0 shadow-md">
                            <MessageSquareWarning size={20} className="text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-extrabold text-gray-800 flex items-center gap-1.5">
                                Complaints <Lock size={9} className="text-red-300" />
                            </p>
                            <p className="text-[10px] text-gray-400 font-medium mt-0.5 truncate">
                                Lodge a formal complaint · Admin reviews & responds
                            </p>
                        </div>
                        <ChevronRight size={16} className="text-red-200 flex-shrink-0" />
                    </button>
                </div>
            </div>
            <BottomNav />
        </div>
    )
}
