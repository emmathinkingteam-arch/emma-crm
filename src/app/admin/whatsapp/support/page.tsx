'use client'

// ============================================================================
// /admin/whatsapp/support — Live Agent Dashboard
// Looks and feels exactly like WhatsApp Web (dark mode)
// ============================================================================

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import {
  Search, MoreVertical, Phone, X,
  Send, Check, CheckCheck, Clock, Circle,
  MessageSquare, Wifi, WifiOff, ChevronDown,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ConvState = 'bot' | 'queued' | 'live' | 'closed'
type Sender    = 'customer' | 'bot' | 'agent'

interface Conversation {
  id: string
  customer_phone: string
  customer_name: string | null
  state: ConvState
  queue_number: number | null
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
  message: string
  created_at: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function fmtConvTime(iso: string) {
  const now  = new Date()
  const date = new Date(iso)
  const diff = now.getTime() - date.getTime()
  if (diff < 86400000) return fmtTime(iso)
  if (diff < 604800000) return date.toLocaleDateString('en-US', { weekday: 'short' })
  return date.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function displayName(conv: Conversation) {
  return conv.customer_name || `+${conv.customer_phone}`
}

function stateColor(state: ConvState) {
  if (state === 'queued') return '#f59e0b'
  if (state === 'live')   return '#22c55e'
  if (state === 'bot')    return '#8696a0'
  return '#475569'
}

function stateLabel(state: ConvState, qn: number | null) {
  if (state === 'queued') return `Queue #${qn}`
  if (state === 'live')   return 'Live'
  if (state === 'bot')    return 'Bot'
  return 'Closed'
}

// Avatar initials
function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('')
  const colors = ['#00a884', '#0077b5', '#7c3aed', '#db2777', '#d97706', '#059669']
  const color  = colors[name.charCodeAt(0) % colors.length]
  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%',
        background: color, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: size * 0.38, fontWeight: 600,
        color: '#fff', flexShrink: 0, userSelect: 'none',
      }}
    >
      {initials || '?'}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function WhatsAppSupportPage() {
  const { user } = useAuthStore()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [messages,      setMessages]      = useState<Message[]>([])
  const [activeConv,    setActiveConv]    = useState<Conversation | null>(null)
  const [searchQ,       setSearchQ]       = useState('')
  const [draft,         setDraft]         = useState('')
  const [sending,       setSending]       = useState(false)
  const [online,        setOnline]        = useState(true)
  const [showClosed,    setShowClosed]    = useState(false)
  const [filter,        setFilter]        = useState<'all' | 'queued' | 'live'>('all')
  const [actionLoading, setActionLoading] = useState(false)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const bottomRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLTextAreaElement>(null)
  const chatBodyRef = useRef<HTMLDivElement>(null)

  // ── Load conversations ───────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    const states = showClosed ? ['bot', 'queued', 'live', 'closed'] : ['bot', 'queued', 'live']
    const { data } = await supabase
      .from('support_conversations')
      .select('*')
      .in('state', states)
      .order('last_message_at', { ascending: false })
    if (data) setConversations(data as Conversation[])
  }, [showClosed])

  useEffect(() => { loadConversations() }, [loadConversations])

  // ── Load messages for active conversation ───────────────────────────────
  const loadMessages = useCallback(async (convId: string) => {
    const { data } = await supabase
      .from('support_messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })
    if (data) setMessages(data as Message[])
  }, [])

  useEffect(() => {
    if (!activeConv) return
    loadMessages(activeConv.id)
  }, [activeConv, loadMessages])

  // ── Auto-scroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleScroll = () => {
    if (!chatBodyRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = chatBodyRef.current
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 150)
  }

  // ── Realtime subscriptions ───────────────────────────────────────────────
  useEffect(() => {
    const convSub = supabase
      .channel('support-conversations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_conversations' },
        (payload) => {
          setConversations(prev => {
            const updated = payload.new as Conversation
            const idx = prev.findIndex(c => c.id === updated.id)
            if (idx >= 0) {
              const next = [...prev]
              next[idx] = updated
              return next.sort((a, b) =>
                new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
              )
            }
            return [updated, ...prev]
          })
          // Keep activeConv in sync
          setActiveConv(prev => prev?.id === (payload.new as Conversation).id ? payload.new as Conversation : prev)
          setOnline(true)
        }
      )
      .subscribe(status => {
        setOnline(status === 'SUBSCRIBED')
      })

    const msgSub = supabase
      .channel('support-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' },
        (payload) => {
          const msg = payload.new as Message
          setMessages(prev => {
            if (prev.find(m => m.id === msg.id)) return prev
            return [...prev, msg]
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(convSub)
      supabase.removeChannel(msgSub)
    }
  }, [])

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleTake = async () => {
    if (!activeConv) return
    setActionLoading(true)
    await fetch('/api/whatsapp/agent/take', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ convId: activeConv.id }),
    })
    setActionLoading(false)
  }

  const handleClose = async () => {
    if (!activeConv) return
    if (!confirm('Close this conversation? A goodbye message will be sent to the customer.')) return
    setActionLoading(true)
    await fetch('/api/whatsapp/agent/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ convId: activeConv.id }),
    })
    setActiveConv(null)
    setMessages([])
    setActionLoading(false)
  }

  const handleSend = async () => {
    if (!activeConv || !draft.trim() || sending) return
    if (activeConv.state !== 'live') return

    const text = draft.trim()
    setDraft('')
    setSending(true)

    // Optimistic
    const temp: Message = {
      id: 'temp-' + Date.now(),
      conversation_id: activeConv.id,
      sender: 'agent',
      agent_id: null,
      message: text,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, temp])

    await fetch('/api/whatsapp/agent/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ convId: activeConv.id, message: text }),
    })

    setSending(false)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ── Filtered conversations ───────────────────────────────────────────────
  const filtered = conversations.filter(c => {
    if (filter === 'queued' && c.state !== 'queued') return false
    if (filter === 'live'   && c.state !== 'live')   return false
    if (!showClosed && c.state === 'closed')          return false
    if (searchQ) {
      const q = searchQ.toLowerCase()
      return (
        c.customer_phone.includes(q) ||
        (c.customer_name?.toLowerCase().includes(q) ?? false)
      )
    }
    return true
  })

  const queuedCount = conversations.filter(c => c.state === 'queued').length
  const liveCount   = conversations.filter(c => c.state === 'live').length

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{
      display: 'flex', height: '100vh', background: '#111b21',
      fontFamily: "'Segoe UI', system-ui, sans-serif", overflow: 'hidden',
    }}>

      {/* ── LEFT SIDEBAR ─────────────────────────────────────────────────── */}
      <div style={{
        width: 380, minWidth: 320, display: 'flex', flexDirection: 'column',
        borderRight: '1px solid #2a3942', background: '#111b21', flexShrink: 0,
      }}>

        {/* Header */}
        <div style={{
          height: 60, padding: '0 16px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', background: '#202c33',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar name={user?.full_name || 'Agent'} size={40} />
            <div>
              <div style={{ color: '#e9edef', fontSize: 15, fontWeight: 500 }}>
                {user?.full_name || 'Agent'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {online
                  ? <><Wifi size={10} color="#00a884" /><span style={{ color: '#00a884', fontSize: 11 }}>connected</span></>
                  : <><WifiOff size={10} color="#f59e0b" /><span style={{ color: '#f59e0b', fontSize: 11 }}>reconnecting…</span></>
                }
              </div>
            </div>
          </div>

          {/* Stats badges */}
          <div style={{ display: 'flex', gap: 8 }}>
            {queuedCount > 0 && (
              <div style={{
                background: '#f59e0b', color: '#000', borderRadius: 10,
                padding: '2px 8px', fontSize: 12, fontWeight: 700,
              }}>
                {queuedCount} waiting
              </div>
            )}
            {liveCount > 0 && (
              <div style={{
                background: '#00a884', color: '#fff', borderRadius: 10,
                padding: '2px 8px', fontSize: 12, fontWeight: 700,
              }}>
                {liveCount} live
              </div>
            )}
          </div>
        </div>

        {/* Search bar */}
        <div style={{ padding: '8px 12px', background: '#111b21' }}>
          <div style={{
            display: 'flex', alignItems: 'center', background: '#202c33',
            borderRadius: 8, padding: '8px 12px', gap: 8,
          }}>
            <Search size={16} color="#8696a0" />
            <input
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Search or start new chat"
              style={{
                background: 'none', border: 'none', outline: 'none',
                color: '#e9edef', fontSize: 14, flex: 1,
              }}
            />
            {searchQ && (
              <button onClick={() => setSearchQ('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                <X size={14} color="#8696a0" />
              </button>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', padding: '0 12px 8px', gap: 6 }}>
          {(['all', 'queued', 'live'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '4px 12px', borderRadius: 12, border: 'none',
                cursor: 'pointer', fontSize: 12, fontWeight: 500,
                background: filter === f ? '#00a884' : '#202c33',
                color: filter === f ? '#fff' : '#8696a0',
                textTransform: 'capitalize',
              }}
            >
              {f}
            </button>
          ))}
          <button
            onClick={() => setShowClosed(p => !p)}
            style={{
              padding: '4px 12px', borderRadius: 12, border: 'none',
              cursor: 'pointer', fontSize: 12, fontWeight: 500,
              background: showClosed ? '#475569' : '#202c33',
              color: showClosed ? '#e9edef' : '#8696a0',
              marginLeft: 'auto',
            }}
          >
            {showClosed ? 'Hide closed' : 'Closed'}
          </button>
        </div>

        {/* Conversation list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: '#8696a0', fontSize: 14 }}>
              <MessageSquare size={32} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.4 }} />
              No conversations
            </div>
          )}
          {filtered.map(conv => (
            <div
              key={conv.id}
              onClick={() => { setActiveConv(conv); setMessages([]) }}
              style={{
                display: 'flex', alignItems: 'center', padding: '12px 16px',
                gap: 12, cursor: 'pointer', borderBottom: '1px solid #1f2c33',
                background: activeConv?.id === conv.id ? '#2a3942' : 'transparent',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => {
                if (activeConv?.id !== conv.id)
                  (e.currentTarget as HTMLElement).style.background = '#202c33'
              }}
              onMouseLeave={e => {
                if (activeConv?.id !== conv.id)
                  (e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              <Avatar name={displayName(conv)} size={49} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{
                    color: '#e9edef', fontSize: 17, fontWeight: 400,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    maxWidth: 180,
                  }}>
                    {displayName(conv)}
                  </span>
                  <span style={{ color: '#8696a0', fontSize: 12, flexShrink: 0 }}>
                    {fmtConvTime(conv.last_message_at)}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                  <span style={{
                    color: '#8696a0', fontSize: 14,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    maxWidth: 200,
                  }}>
                    {conv.last_message || 'No messages yet'}
                  </span>
                  <span style={{
                    background: stateColor(conv.state),
                    color: conv.state === 'queued' ? '#000' : '#fff',
                    borderRadius: 8, padding: '1px 6px', fontSize: 11, fontWeight: 600,
                    flexShrink: 0, marginLeft: 4,
                  }}>
                    {stateLabel(conv.state, conv.queue_number)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── RIGHT: CHAT PANEL ────────────────────────────────────────────── */}
      {!activeConv ? (

        /* Empty state */
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#222e35', gap: 16,
        }}>
          <div style={{
            width: 200, height: 200, borderRadius: '50%',
            background: '#2a3942', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <MessageSquare size={80} color="#00a884" strokeWidth={1} />
          </div>
          <div style={{ color: '#e9edef', fontSize: 32, fontWeight: 300 }}>
            WhatsApp Support
          </div>
          <div style={{ color: '#8696a0', fontSize: 14, textAlign: 'center', maxWidth: 360 }}>
            Select a conversation from the left to start.<br />
            New messages appear in real-time — no refresh needed.
          </div>
          <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#f59e0b', fontSize: 28, fontWeight: 700 }}>{queuedCount}</div>
              <div style={{ color: '#8696a0', fontSize: 13 }}>Waiting</div>
            </div>
            <div style={{ width: 1, background: '#2a3942' }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#00a884', fontSize: 28, fontWeight: 700 }}>{liveCount}</div>
              <div style={{ color: '#8696a0', fontSize: 13 }}>Live chats</div>
            </div>
          </div>
        </div>

      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0b1418' }}>

          {/* Chat header */}
          <div style={{
            height: 60, padding: '0 16px', display: 'flex', alignItems: 'center',
            gap: 12, background: '#202c33', flexShrink: 0,
          }}>
            <Avatar name={displayName(activeConv)} size={40} />

            <div style={{ flex: 1 }}>
              <div style={{ color: '#e9edef', fontSize: 16, fontWeight: 500 }}>
                {displayName(activeConv)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Circle
                  size={8}
                  fill={stateColor(activeConv.state)}
                  color={stateColor(activeConv.state)}
                />
                <span style={{ color: '#8696a0', fontSize: 13 }}>
                  +{activeConv.customer_phone} · {stateLabel(activeConv.state, activeConv.queue_number)}
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {activeConv.state === 'queued' && (
                <button
                  onClick={handleTake}
                  disabled={actionLoading}
                  style={{
                    background: '#00a884', color: '#fff', border: 'none',
                    borderRadius: 8, padding: '8px 18px', fontSize: 14,
                    fontWeight: 600, cursor: actionLoading ? 'not-allowed' : 'pointer',
                    opacity: actionLoading ? 0.6 : 1,
                  }}
                >
                  {actionLoading ? 'Taking…' : '👨‍💼 Take conversation'}
                </button>
              )}
              {activeConv.state === 'live' && (
                <button
                  onClick={handleClose}
                  disabled={actionLoading}
                  style={{
                    background: '#ef4444', color: '#fff', border: 'none',
                    borderRadius: 8, padding: '8px 18px', fontSize: 14,
                    fontWeight: 600, cursor: actionLoading ? 'not-allowed' : 'pointer',
                    opacity: actionLoading ? 0.6 : 1,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <X size={14} /> {actionLoading ? 'Closing…' : 'Close chat'}
                </button>
              )}
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <Phone size={20} color="#8696a0" />
              </button>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <MoreVertical size={20} color="#8696a0" />
              </button>
            </div>
          </div>

          {/* Queued notice bar */}
          {activeConv.state === 'queued' && (
            <div style={{
              background: '#1a2a1a', borderBottom: '1px solid #2a4a2a',
              padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <Clock size={14} color="#f59e0b" />
              <span style={{ color: '#f59e0b', fontSize: 13 }}>
                Customer is in queue #{activeConv.queue_number}. Click &quot;Take conversation&quot; to start chatting.
              </span>
            </div>
          )}

          {/* Messages area */}
          <div
            ref={chatBodyRef}
            onScroll={handleScroll}
            style={{
              flex: 1, overflowY: 'auto', padding: '12px 6%',
              display: 'flex', flexDirection: 'column', gap: 2,
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Crect width='60' height='60' fill='%230b1418'/%3E%3Ccircle cx='30' cy='30' r='1' fill='%23ffffff08'/%3E%3C/svg%3E")`,
            }}
          >
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', color: '#8696a0', fontSize: 13, padding: '32px 0' }}>
                No messages yet
              </div>
            )}
            {messages.map((msg, idx) => {
              const isCustomer = msg.sender === 'customer'
              const isBot      = msg.sender === 'bot'
              const isAgent    = msg.sender === 'agent'
              const isOutgoing = isBot || isAgent
              const prevMsg    = messages[idx - 1]
              const sameSender = prevMsg?.sender === msg.sender
              const showAvatar = !isOutgoing && !sameSender

              return (
                <div
                  key={msg.id}
                  style={{
                    display: 'flex',
                    justifyContent: isOutgoing ? 'flex-end' : 'flex-start',
                    marginBottom: sameSender ? 1 : 6,
                    marginTop: showAvatar ? 4 : 0,
                  }}
                >
                  {!isOutgoing && (
                    <div style={{ width: 32, marginRight: 6, flexShrink: 0 }}>
                      {showAvatar && <Avatar name={displayName(activeConv)} size={32} />}
                    </div>
                  )}

                  <div style={{ maxWidth: '65%' }}>
                    {/* Sender label */}
                    {!sameSender && isAgent && (
                      <div style={{ color: '#00a884', fontSize: 12, marginBottom: 2, textAlign: 'right' }}>
                        {user?.full_name || 'Agent'}
                      </div>
                    )}

                    <div style={{
                      background:   isOutgoing
                        ? (isBot ? '#1e3a1e' : '#005c4b')
                        : '#202c33',
                      borderRadius: isOutgoing
                        ? (sameSender ? '12px 3px 12px 12px' : '12px 3px 12px 12px')
                        : (sameSender ? '3px 12px 12px 12px' : '12px 12px 12px 3px'),
                      padding: '7px 14px 8px',
                      position: 'relative',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
                    }}>
                      {/* Bot badge */}
                      {isBot && (
                        <div style={{
                          fontSize: 10, color: '#4ade80', fontWeight: 600, marginBottom: 4,
                          opacity: 0.8,
                        }}>
                          🤖 BOT
                        </div>
                      )}

                      <pre style={{
                        color: '#e9edef', fontSize: 14.2, lineHeight: 1.5,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        margin: 0, fontFamily: 'inherit',
                      }}>
                        {msg.message}
                      </pre>

                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                        gap: 3, marginTop: 2,
                      }}>
                        <span style={{ color: '#8696a0', fontSize: 11 }}>
                          {fmtTime(msg.created_at)}
                        </span>
                        {isAgent && (
                          msg.id.startsWith('temp-')
                            ? <Clock size={11} color="#8696a0" />
                            : <CheckCheck size={13} color="#53bdeb" />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          {/* Scroll to bottom button */}
          {showScrollBtn && (
            <button
              onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
              style={{
                position: 'absolute', bottom: 80, right: '5%',
                background: '#202c33', border: 'none', borderRadius: '50%',
                width: 40, height: 40, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <ChevronDown size={18} color="#8696a0" />
            </button>
          )}

          {/* Input area */}
          <div style={{
            background: '#202c33', padding: '10px 16px',
            display: 'flex', alignItems: 'flex-end', gap: 10, flexShrink: 0,
          }}>
            {activeConv.state === 'live' ? (
              <>
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message"
                  rows={1}
                  style={{
                    flex: 1, background: '#2a3942', border: 'none', outline: 'none',
                    borderRadius: 8, padding: '9px 14px', color: '#e9edef', fontSize: 15,
                    resize: 'none', lineHeight: 1.5, maxHeight: 120,
                    fontFamily: 'inherit', overflowY: 'auto',
                  }}
                  onInput={e => {
                    const t = e.currentTarget
                    t.style.height = 'auto'
                    t.style.height = Math.min(t.scrollHeight, 120) + 'px'
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={!draft.trim() || sending}
                  style={{
                    width: 44, height: 44, borderRadius: '50%', border: 'none',
                    background: draft.trim() ? '#00a884' : '#8696a0',
                    cursor: draft.trim() ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.2s', flexShrink: 0,
                  }}
                >
                  <Send size={18} color="#fff" style={{ marginLeft: 2 }} />
                </button>
              </>
            ) : (
              <div style={{
                flex: 1, textAlign: 'center', color: '#8696a0', fontSize: 14,
                padding: '10px 0',
              }}>
                {activeConv.state === 'queued'
                  ? '⬆️ Take the conversation above to start chatting'
                  : activeConv.state === 'closed'
                    ? '🔒 This conversation is closed'
                    : '🤖 Bot is handling this conversation'
                }
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  )
}
