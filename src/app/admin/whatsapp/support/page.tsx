'use client'

// ============================================================================
// /admin/whatsapp/support — Live Agent Dashboard
// Looks like real WhatsApp (light theme). Renders text / image / voice.
// Handoff is invisible to the customer; agents continue in Maashi's voice.
// ============================================================================

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import {
  Search, MoreVertical, Phone, X, Send, CheckCheck, Clock,
  MessageSquare, Smile, ChevronDown, AlertTriangle, Video, Plus, Trash2,
} from 'lucide-react'

// ── Types ───────────────────────────────────────────────────────────────────
type ConvState = 'bot' | 'queued' | 'live' | 'closed'
type Sender    = 'customer' | 'bot' | 'agent'
type MsgType   = 'text' | 'image' | 'audio' | 'document' | string

interface Conversation {
  id: string
  customer_phone: string
  customer_name: string | null
  state: ConvState
  queue_number: number | null
  escalation_reason: string | null
  assigned_agent_id: string | null
  last_message: string | null
  last_message_at: string
  created_at: string
}

interface Message {
  id: string
  conversation_id: string
  sender: Sender
  agent_id: string | null
  type: MsgType
  message: string
  media_url: string | null
  transcript: string | null
  created_at: string
}

// ── WhatsApp palette (light) ─────────────────────────────────────────────────
const WA = {
  panelBg: '#f0f2f5',
  headerBg: '#f0f2f5',
  chatWall: '#efeae2',
  outgoing: '#d9fdd3',
  incoming: '#ffffff',
  green: '#00a884',
  text: '#111b21',
  sub: '#667781',
  border: '#e9edef',
}

const EMOJIS = ['😊','😄','🙏','👍','❤️','🙂','😅','🎉','🔥','😍','😂','🥰','👌','🙌','✅','😘','🤝','💐','🌸','😎']

// ── Helpers ───────────────────────────────────────────────────────────────
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
}
function fmtConvTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 86400000) return fmtTime(iso)
  if (diff < 604800000) return new Date(iso).toLocaleDateString('en-US', { weekday: 'short' })
  return new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
function displayName(c: Conversation) { return c.customer_name || `+${c.customer_phone}` }

function stateBadge(state: ConvState, qn: number | null): { label: string; bg: string; fg: string } | null {
  if (state === 'queued') return { label: 'Needs you', bg: '#FECACA', fg: '#991B1B' }
  if (state === 'live')   return { label: 'Live', bg: '#D1FAE5', fg: '#065F46' }
  if (state === 'bot')    return { label: 'Maashi', bg: '#E0E7FF', fg: '#3730A3' }
  return { label: 'Closed', bg: '#F1F5F9', fg: '#475569' }
}

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name.replace('+', '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')
  const colors = ['#00a884', '#0077b5', '#7c3aed', '#db2777', '#d97706', '#059669']
  const color = colors[(name.charCodeAt(0) || 0) % colors.length]
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 600, color: '#fff', flexShrink: 0, userSelect: 'none',
    }}>{initials || '?'}</div>
  )
}

// ── Main ────────────────────────────────────────────────────────────────────
export default function WhatsAppSupportPage() {
  const { user } = useAuthStore()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [activeConv, setActiveConv] = useState<Conversation | null>(null)
  const [searchQ, setSearchQ] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [showClosed, setShowClosed] = useState(false)
  const [filter, setFilter] = useState<'all' | 'queued' | 'live'>('all')
  const [actionLoading, setActionLoading] = useState(false)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [aiProvider, setAiProvider] = useState<'claude' | 'gemini' | 'gpt'>('claude')
  const [providerSaving, setProviderSaving] = useState(false)

  // Load the active AI provider once
  useEffect(() => {
    fetch('/api/whatsapp/bot-settings')
      .then(r => r.json())
      .then(d => { if (d?.ok && d.ai_provider) setAiProvider(d.ai_provider) })
      .catch(() => {})
  }, [])

  const switchProvider = async (next: 'claude' | 'gemini' | 'gpt') => {
    if (next === aiProvider || providerSaving) return
    setProviderSaving(true)
    const prev = aiProvider
    setAiProvider(next) // optimistic
    try {
      const r = await fetch('/api/whatsapp/bot-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_provider: next }),
      })
      const d = await r.json()
      if (!d?.ok) { setAiProvider(prev); alert(d?.reason || 'Failed to switch provider') }
    } catch {
      setAiProvider(prev)
      alert('Failed to switch provider')
    } finally {
      setProviderSaving(false)
    }
  }

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const chatBodyRef = useRef<HTMLDivElement>(null)

  // ── Load conversations ─────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    const states = showClosed ? ['bot', 'queued', 'live', 'closed'] : ['bot', 'queued', 'live']
    const { data } = await supabase
      .from('support_conversations').select('*')
      .in('state', states).order('last_message_at', { ascending: false })
    if (data) setConversations(data as Conversation[])
  }, [showClosed])
  useEffect(() => { loadConversations() }, [loadConversations])

  // deep link ?conv=
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('conv')
    if (id && conversations.length && !activeConv) {
      const c = conversations.find(x => x.id === id)
      if (c) setActiveConv(c)
    }
  }, [conversations, activeConv])

  // ── Load messages ───────────────────────────────────────────────────────
  const loadMessages = useCallback(async (convId: string) => {
    const { data } = await supabase
      .from('support_messages').select('*')
      .eq('conversation_id', convId).order('created_at', { ascending: true })
    if (data) setMessages(data as Message[])
  }, [])
  useEffect(() => { if (activeConv) loadMessages(activeConv.id) }, [activeConv, loadMessages])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const handleScroll = () => {
    if (!chatBodyRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = chatBodyRef.current
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 150)
  }

  // ── Realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const convSub = supabase.channel('support-conversations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_conversations' }, (payload) => {
        setConversations(prev => {
          const updated = payload.new as Conversation
          const idx = prev.findIndex(c => c.id === updated.id)
          if (idx >= 0) {
            const next = [...prev]; next[idx] = updated
            return next.sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime())
          }
          return [updated, ...prev]
        })
        setActiveConv(prev => prev?.id === (payload.new as Conversation).id ? payload.new as Conversation : prev)
      }).subscribe()

    const msgSub = supabase.channel('support-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, (payload) => {
        const msg = payload.new as Message
        setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg])
      }).subscribe()

    return () => { supabase.removeChannel(convSub); supabase.removeChannel(msgSub) }
  }, [])

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleTake = async () => {
    if (!activeConv) return
    setActionLoading(true)
    await fetch('/api/whatsapp/agent/take', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ convId: activeConv.id }),
    })
    setActionLoading(false)
  }
  const handleClose = async () => {
    if (!activeConv) return
    if (!confirm('Close this conversation?')) return
    setActionLoading(true)
    await fetch('/api/whatsapp/agent/close', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ convId: activeConv.id }),
    })
    setActiveConv(null); setMessages([]); setActionLoading(false)
  }
  const handleSend = async () => {
    if (!activeConv || !draft.trim() || sending || activeConv.state !== 'live') return
    const text = draft.trim(); setDraft(''); setSending(true); setShowEmoji(false)
    const temp: Message = {
      id: 'temp-' + Date.now(), conversation_id: activeConv.id, sender: 'agent',
      agent_id: null, type: 'text', message: text, media_url: null, transcript: null,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, temp])
    await fetch('/api/whatsapp/agent/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ convId: activeConv.id, message: text }),
    })
    setSending(false); inputRef.current?.focus()
  }
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  // Flush Chat: close this conversation so the next message from the customer starts
  // a brand-new chat with zero history sent to the AI — dramatically cuts token usage.
  // Complaints in support_complaints are untouched.
  const handleFlushChat = async () => {
    if (!activeConv) return
    if (!confirm('Flush this chat? The conversation will close. Next message from this customer starts fresh (less AI tokens used). Complaints are kept.')) return
    setActionLoading(true)
    await supabase.from('support_conversations').update({
      state: 'closed',
      closed_at: new Date().toISOString(),
    }).eq('id', activeConv.id)
    setActiveConv(null)
    setMessages([])
    setActionLoading(false)
    await loadConversations()
  }

  const filtered = conversations.filter(c => {
    if (filter === 'queued' && c.state !== 'queued') return false
    if (filter === 'live' && c.state !== 'live') return false
    if (!showClosed && c.state === 'closed') return false
    if (searchQ) {
      const q = searchQ.toLowerCase()
      return c.customer_phone.includes(q) || (c.customer_name?.toLowerCase().includes(q) ?? false)
    }
    return true
  })
  const queuedCount = conversations.filter(c => c.state === 'queued').length
  const liveCount = conversations.filter(c => c.state === 'live').length

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100vh', background: WA.panelBg, fontFamily: "'Segoe UI', system-ui, sans-serif", overflow: 'hidden' }}>

      {/* LEFT SIDEBAR */}
      <div style={{ width: 400, minWidth: 320, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${WA.border}`, background: '#fff', flexShrink: 0 }}>
        <div style={{ height: 60, padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: WA.headerBg }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar name={user?.full_name || 'Agent'} size={40} />
            <div style={{ color: WA.text, fontSize: 16, fontWeight: 600 }}>Chats</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {queuedCount > 0 && <span style={{ background: '#EF4444', color: '#fff', borderRadius: 10, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>{queuedCount} need you</span>}
            {liveCount > 0 && <span style={{ background: WA.green, color: '#fff', borderRadius: 10, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>{liveCount} live</span>}
            {/* AI provider switch — flips the Maashi bot between Claude and Gemini */}
            <div title="Which AI model powers Maashi" style={{ display: 'flex', background: '#fff', border: `1px solid ${WA.border}`, borderRadius: 999, padding: 2, opacity: providerSaving ? 0.6 : 1 }}>
              {([
                { id: 'claude', label: 'Claude', color: '#D97757' },
                { id: 'gemini', label: 'Gemini', color: '#1A73E8' },
                { id: 'gpt', label: 'GPT', color: '#10A37F' },
              ] as const).map(p => (
                <button key={p.id} onClick={() => switchProvider(p.id)} disabled={providerSaving} style={{
                  padding: '3px 10px', borderRadius: 999, border: 'none', cursor: providerSaving ? 'default' : 'pointer',
                  fontSize: 11, fontWeight: 700,
                  background: aiProvider === p.id ? p.color : 'transparent',
                  color: aiProvider === p.id ? '#fff' : WA.sub,
                }}>{p.label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Search */}
        <div style={{ padding: '8px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', background: WA.panelBg, borderRadius: 8, padding: '7px 12px', gap: 8 }}>
            <Search size={16} color={WA.sub} />
            <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search or start new chat"
              style={{ background: 'none', border: 'none', outline: 'none', color: WA.text, fontSize: 14, flex: 1 }} />
            {searchQ && <button onClick={() => setSearchQ('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}><X size={14} color={WA.sub} /></button>}
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', padding: '0 12px 8px', gap: 6 }}>
          {(['all', 'queued', 'live'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '4px 12px', borderRadius: 14, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              background: filter === f ? WA.green : WA.panelBg, color: filter === f ? '#fff' : WA.sub, textTransform: 'capitalize',
            }}>{f === 'queued' ? 'Needs you' : f}</button>
          ))}
          <button onClick={() => setShowClosed(p => !p)} style={{
            padding: '4px 12px', borderRadius: 14, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
            background: showClosed ? '#475569' : WA.panelBg, color: showClosed ? '#fff' : WA.sub, marginLeft: 'auto',
          }}>{showClosed ? 'Hide closed' : 'Closed'}</button>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: WA.sub, fontSize: 14 }}>
              <MessageSquare size={32} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.4 }} /> No conversations
            </div>
          )}
          {filtered.map(conv => {
            const badge = stateBadge(conv.state, conv.queue_number)
            const active = activeConv?.id === conv.id
            return (
              <div key={conv.id} onClick={() => { setActiveConv(conv); setMessages([]) }}
                style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', gap: 13, cursor: 'pointer',
                  borderBottom: `1px solid ${WA.border}`, background: active ? '#f0f2f5' : 'transparent' }}>
                <Avatar name={displayName(conv)} size={49} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: WA.text, fontSize: 16, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{displayName(conv)}</span>
                    <span style={{ color: WA.sub, fontSize: 12, flexShrink: 0 }}>{fmtConvTime(conv.last_message_at)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 }}>
                    <span style={{ color: WA.sub, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 230 }}>{conv.last_message || 'No messages yet'}</span>
                    {badge && <span style={{ background: badge.bg, color: badge.fg, borderRadius: 8, padding: '1px 7px', fontSize: 10.5, fontWeight: 700, flexShrink: 0, marginLeft: 4 }}>{badge.label}</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* RIGHT */}
      {!activeConv ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f8f9fa', gap: 14, borderBottom: `6px solid ${WA.green}` }}>
          <div style={{ width: 180, height: 180, borderRadius: '50%', background: '#e9edef', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MessageSquare size={72} color={WA.green} strokeWidth={1} />
          </div>
          <div style={{ color: WA.text, fontSize: 30, fontWeight: 300 }}>Emma Thinking Support</div>
          <div style={{ color: WA.sub, fontSize: 14, textAlign: 'center', maxWidth: 380 }}>
            Maashi handles chats automatically. When a customer needs you, the chat is flagged <b>Needs you</b> — open it and tap Take.
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: WA.chatWall, position: 'relative' }}>
          {/* Header */}
          <div style={{ height: 60, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 12, background: WA.headerBg, flexShrink: 0, borderLeft: `1px solid ${WA.border}` }}>
            <Avatar name={displayName(activeConv)} size={40} />
            <div style={{ flex: 1 }}>
              <div style={{ color: WA.text, fontSize: 16, fontWeight: 600 }}>{displayName(activeConv)}</div>
              <div style={{ color: WA.sub, fontSize: 12.5 }}>+{activeConv.customer_phone}</div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {activeConv.state === 'queued' && (
                <button onClick={handleTake} disabled={actionLoading} style={{
                  background: WA.green, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px',
                  fontSize: 14, fontWeight: 700, cursor: actionLoading ? 'not-allowed' : 'pointer', opacity: actionLoading ? 0.6 : 1,
                }}>{actionLoading ? 'Taking…' : 'Take chat'}</button>
              )}
              {activeConv.state === 'live' && (
                <button onClick={handleClose} disabled={actionLoading} style={{
                  background: '#fff', color: '#EF4444', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 16px',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                }}><X size={14} /> {actionLoading ? 'Closing…' : 'Close'}</button>
              )}
              <button
                onClick={handleFlushChat}
                disabled={actionLoading}
                title="Flush Chat — close this conversation so next message starts fresh (saves AI tokens)"
                style={{
                  background: 'none', border: '1px solid #FECACA', borderRadius: 7, cursor: actionLoading ? 'not-allowed' : 'pointer',
                  padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 5,
                  color: '#DC2626', fontSize: 12, fontWeight: 600, opacity: actionLoading ? 0.5 : 1,
                }}
              >
                <Trash2 size={13} /> Flush Chat
              </button>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><Video size={20} color={WA.sub} /></button>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><Phone size={19} color={WA.sub} /></button>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><MoreVertical size={20} color={WA.sub} /></button>
            </div>
          </div>

          {/* Needs-you banner */}
          {activeConv.state === 'queued' && (
            <div style={{ background: '#FEF2F2', borderBottom: '1px solid #FECACA', padding: '9px 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={15} color="#DC2626" />
              <span style={{ color: '#991B1B', fontSize: 13, fontWeight: 500 }}>
                This customer needs you{activeConv.escalation_reason ? ` (${activeConv.escalation_reason.replace(/_/g, ' ')})` : ''}. Tap <b>Take chat</b> — the customer won&apos;t know it&apos;s you taking over.
              </span>
            </div>
          )}

          {/* Messages */}
          <div ref={chatBodyRef} onScroll={handleScroll} style={{
            flex: 1, overflowY: 'auto', padding: '14px 7%', display: 'flex', flexDirection: 'column', gap: 2,
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Crect width='60' height='60' fill='%23efeae2'/%3E%3Ccircle cx='30' cy='30' r='1' fill='%23d1c7bd55'/%3E%3C/svg%3E")`,
          }}>
            {messages.length === 0 && <div style={{ textAlign: 'center', color: WA.sub, fontSize: 13, padding: '32px 0' }}>No messages yet</div>}
            {messages.map((msg, idx) => {
              const isOutgoing = msg.sender === 'bot' || msg.sender === 'agent'
              const isBot = msg.sender === 'bot'
              const sameSender = messages[idx - 1]?.sender === msg.sender
              return (
                <div key={msg.id} style={{ display: 'flex', justifyContent: isOutgoing ? 'flex-end' : 'flex-start', marginBottom: sameSender ? 1 : 6 }}>
                  <div style={{ maxWidth: '66%' }}>
                    <div style={{
                      background: isOutgoing ? WA.outgoing : WA.incoming,
                      borderRadius: 8, padding: msg.type === 'image' ? 4 : '6px 9px 8px',
                      boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)', position: 'relative',
                    }}>
                      {/* internal-only marker: who sent it (customer never sees this) */}
                      {isOutgoing && !sameSender && (
                        <div style={{ fontSize: 10.5, color: isBot ? '#7c3aed' : WA.green, fontWeight: 700, marginBottom: 2 }}>
                          {isBot ? 'Maashi (auto)' : user?.full_name || 'You'}
                        </div>
                      )}

                      {/* image */}
                      {msg.type === 'image' && msg.media_url && (
                        <a href={msg.media_url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={msg.media_url} alt="photo" style={{ maxWidth: 260, borderRadius: 6, display: 'block' }} />
                        </a>
                      )}

                      {/* voice note */}
                      {msg.type === 'audio' && (
                        <div style={{ minWidth: 220 }}>
                          {msg.media_url && <audio controls src={msg.media_url} style={{ width: 240, height: 36 }} />}
                          {msg.transcript && (
                            <div style={{ fontSize: 12.5, color: WA.sub, marginTop: 4, fontStyle: 'italic' }}>“{msg.transcript}”</div>
                          )}
                        </div>
                      )}

                      {/* text (and caption) */}
                      {msg.type !== 'audio' && (msg.type !== 'image' || msg.message) && (
                        <div style={{ color: WA.text, fontSize: 14.4, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {msg.message}
                        </div>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3, marginTop: 2 }}>
                        <span style={{ color: WA.sub, fontSize: 11 }}>{fmtTime(msg.created_at)}</span>
                        {(isOutgoing) && (msg.id.startsWith('temp-') ? <Clock size={11} color={WA.sub} /> : <CheckCheck size={14} color="#53bdeb" />)}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          {showScrollBtn && (
            <button onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })} style={{
              position: 'absolute', bottom: 80, right: '5%', background: '#fff', border: 'none', borderRadius: '50%',
              width: 40, height: 40, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><ChevronDown size={18} color={WA.sub} /></button>
          )}

          {/* Composer */}
          <div style={{ background: WA.headerBg, padding: '8px 16px', display: 'flex', alignItems: 'flex-end', gap: 10, flexShrink: 0, position: 'relative' }}>
            {activeConv.state === 'live' ? (
              <>
                {showEmoji && (
                  <div style={{ position: 'absolute', bottom: 60, left: 16, background: '#fff', border: `1px solid ${WA.border}`, borderRadius: 12, padding: 10, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', zIndex: 10 }}>
                    {EMOJIS.map(e => (
                      <button key={e} onClick={() => { setDraft(d => d + e); inputRef.current?.focus() }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, padding: 2 }}>{e}</button>
                    ))}
                  </div>
                )}
                <button onClick={() => setShowEmoji(s => !s)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6 }}>
                  <Smile size={24} color={WA.sub} />
                </button>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6 }}><Plus size={24} color={WA.sub} /></button>
                <textarea ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={handleKeyDown}
                  placeholder="Type a message" rows={1}
                  style={{ flex: 1, background: '#fff', border: 'none', outline: 'none', borderRadius: 8, padding: '9px 14px', color: WA.text, fontSize: 15, resize: 'none', lineHeight: 1.4, maxHeight: 120, fontFamily: 'inherit' }}
                  onInput={e => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px' }} />
                <button onClick={handleSend} disabled={!draft.trim() || sending} style={{
                  width: 44, height: 44, borderRadius: '50%', border: 'none', background: WA.green,
                  cursor: draft.trim() ? 'pointer' : 'default', opacity: draft.trim() ? 1 : 0.5,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}><Send size={18} color="#fff" style={{ marginLeft: 2 }} /></button>
              </>
            ) : (
              <div style={{ flex: 1, textAlign: 'center', color: WA.sub, fontSize: 14, padding: '12px 0' }}>
                {activeConv.state === 'queued' ? 'Tap “Take chat” above to reply'
                  : activeConv.state === 'closed' ? 'This conversation is closed'
                  : 'Maashi is handling this conversation'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
