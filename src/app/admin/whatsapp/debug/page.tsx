'use client'

import { useState } from 'react'
import { Bug, Send, Database, RefreshCw, CheckCircle, XCircle } from 'lucide-react'

interface DebugResult {
    ok: boolean
    logs: string[]
    error?: string
    conversation?: Record<string, unknown>
    conversations?: Record<string, unknown>[]
    messages?: Record<string, unknown>[]
    messageId?: string
}

export default function WhatsAppDebugPage() {
    const [phone, setPhone] = useState('94761552286')
    const [message, setMessage] = useState('hi')
    const [result, setResult] = useState<DebugResult | null>(null)
    const [loading, setLoading] = useState(false)

    const run = async (action: string) => {
        setLoading(true)
        setResult(null)
        try {
            const res = await fetch('/api/whatsapp/debug', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, phone, message }),
            })
            const data = await res.json()
            setResult(data)
        } catch (e) {
            setResult({ ok: false, logs: [], error: String(e) })
        }
        setLoading(false)
    }

    const btn = (label: string, action: string, color: string, icon: React.ReactNode) => (
        <button
            onClick={() => run(action)}
            disabled={loading}
            style={{
                background: loading ? '#374151' : color,
                color: '#fff', border: 'none', borderRadius: 8,
                padding: '10px 20px', fontSize: 14, fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
                opacity: loading ? 0.6 : 1,
            }}
        >
            {icon} {label}
        </button>
    )

    return (
        <div style={{ padding: 32, background: '#0f172a', minHeight: '100vh', color: '#e2e8f0', fontFamily: 'monospace' }}>
            <div style={{ maxWidth: 800, margin: '0 auto' }}>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
                    <Bug size={28} color="#f59e0b" />
                    <h1 style={{ margin: 0, fontSize: 24, color: '#f1f5f9' }}>WhatsApp Support Debug</h1>
                </div>

                {/* Inputs */}
                <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, marginBottom: 24 }}>
                    <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
                                PHONE NUMBER (no + sign)
                            </label>
                            <input
                                value={phone}
                                onChange={e => setPhone(e.target.value)}
                                style={{
                                    width: '100%', background: '#0f172a', border: '1px solid #334155',
                                    borderRadius: 6, padding: '8px 12px', color: '#e2e8f0', fontSize: 14,
                                    boxSizing: 'border-box',
                                }}
                            />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
                                MESSAGE TEXT
                            </label>
                            <input
                                value={message}
                                onChange={e => setMessage(e.target.value)}
                                style={{
                                    width: '100%', background: '#0f172a', border: '1px solid #334155',
                                    borderRadius: 6, padding: '8px 12px', color: '#e2e8f0', fontSize: 14,
                                    boxSizing: 'border-box',
                                }}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {btn('Simulate Inbound Message', 'simulate', '#7c3aed', <RefreshCw size={14} />)}
                        {btn('Test Direct Send', 'test_send', '#0369a1', <Send size={14} />)}
                        {btn('Check DB Tables', 'check', '#065f46', <Database size={14} />)}
                    </div>

                    <p style={{ fontSize: 12, color: '#64748b', marginTop: 12, marginBottom: 0 }}>
                        <b>Simulate</b> = pretend a customer sent a message (tests full bot flow) &nbsp;|&nbsp;
                        <b>Test Send</b> = send a real WhatsApp message to the phone number &nbsp;|&nbsp;
                        <b>Check DB</b> = see what's in the tables
                    </p>
                </div>

                {/* Loading */}
                {loading && (
                    <div style={{ textAlign: 'center', color: '#94a3b8', padding: 32 }}>
                        Running...
                    </div>
                )}

                {/* Result */}
                {result && (
                    <div style={{ background: '#1e293b', borderRadius: 12, padding: 24 }}>

                        {/* Status */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                            {result.ok
                                ? <><CheckCircle size={20} color="#22c55e" /><span style={{ color: '#22c55e', fontWeight: 700 }}>SUCCESS</span></>
                                : <><XCircle size={20} color="#ef4444" /><span style={{ color: '#ef4444', fontWeight: 700 }}>FAILED</span></>
                            }
                            {result.error && (
                                <span style={{ color: '#fca5a5', fontSize: 14 }}>— {result.error}</span>
                            )}
                        </div>

                        {/* Logs */}
                        {result.logs?.length > 0 && (
                            <div style={{ marginBottom: 20 }}>
                                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8, fontWeight: 700 }}>
                                    EXECUTION LOGS
                                </div>
                                <div style={{ background: '#0f172a', borderRadius: 8, padding: 16 }}>
                                    {result.logs.map((log, i) => (
                                        <div key={i} style={{
                                            fontSize: 13, lineHeight: 1.8,
                                            color: log.includes('❌') ? '#fca5a5' : log.includes('✅') ? '#86efac' : '#cbd5e1',
                                        }}>
                                            <span style={{ color: '#475569', marginRight: 8 }}>{String(i + 1).padStart(2, '0')}</span>
                                            {log}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Conversation */}
                        {result.conversation && (
                            <div style={{ marginBottom: 20 }}>
                                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8, fontWeight: 700 }}>
                                    CONVERSATION IN DB
                                </div>
                                <pre style={{
                                    background: '#0f172a', borderRadius: 8, padding: 16,
                                    fontSize: 12, color: '#86efac', overflow: 'auto', margin: 0,
                                }}>
                                    {JSON.stringify(result.conversation, null, 2)}
                                </pre>
                            </div>
                        )}

                        {/* Conversations list */}
                        {result.conversations && (
                            <div style={{ marginBottom: 20 }}>
                                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8, fontWeight: 700 }}>
                                    RECENT CONVERSATIONS ({result.conversations.length})
                                </div>
                                {result.conversations.length === 0
                                    ? <div style={{ color: '#f59e0b', fontSize: 13 }}>No conversations yet</div>
                                    : result.conversations.map((c, i) => (
                                        <div key={i} style={{
                                            background: '#0f172a', borderRadius: 8, padding: 12,
                                            marginBottom: 8, fontSize: 12, color: '#cbd5e1',
                                        }}>
                                            📱 {String(c.customer_phone)} &nbsp;|&nbsp;
                                            state: <span style={{ color: '#86efac' }}>{String(c.state)}</span> &nbsp;|&nbsp;
                                            bot_step: {String(c.bot_step)} &nbsp;|&nbsp;
                                            {String(c.created_at).slice(0, 19)}
                                        </div>
                                    ))
                                }
                            </div>
                        )}

                        {/* Messages list */}
                        {result.messages && (
                            <div>
                                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8, fontWeight: 700 }}>
                                    RECENT MESSAGES ({result.messages.length})
                                </div>
                                {result.messages.length === 0
                                    ? <div style={{ color: '#f59e0b', fontSize: 13 }}>No messages yet</div>
                                    : result.messages.map((m, i) => (
                                        <div key={i} style={{
                                            background: '#0f172a', borderRadius: 8, padding: 12,
                                            marginBottom: 8, fontSize: 12,
                                        }}>
                                            <span style={{ color: m.sender === 'customer' ? '#60a5fa' : m.sender === 'bot' ? '#a78bfa' : '#34d399' }}>
                                                [{String(m.sender).toUpperCase()}]
                                            </span>
                                            {' '}<span style={{ color: '#cbd5e1' }}>{String(m.message).slice(0, 100)}</span>
                                            <span style={{ color: '#475569', float: 'right' }}>{String(m.created_at).slice(11, 19)}</span>
                                        </div>
                                    ))
                                }
                            </div>
                        )}

                    </div>
                )}
            </div>
        </div>
    )
}
