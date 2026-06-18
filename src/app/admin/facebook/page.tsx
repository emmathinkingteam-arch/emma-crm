'use client'

// ============================================================================
// /admin/facebook — one-time "Connect Facebook" for auto-posting (admin only).
//
// The admin pastes App ID, App Secret and a short-lived User token. The server
// (/api/facebook/connect) exchanges them into a PERMANENT page token and stores
// it. After that the Post Builder's "Schedule on Facebook" button works.
// ============================================================================

import { useEffect, useState } from 'react'
import { Loader2, CheckCircle2, Facebook, ExternalLink } from 'lucide-react'

const DEFAULT_APP_ID = '1472466964898108'

export default function ConnectFacebookPage() {
  const [appId, setAppId] = useState(DEFAULT_APP_ID)
  const [appSecret, setAppSecret] = useState('')
  const [userToken, setUserToken] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [connected, setConnected] = useState<{ pageName: string | null; pageId: string | null } | null>(null)

  const loadStatus = async () => {
    try {
      const res = await fetch('/api/facebook/connect')
      const j = await res.json()
      if (res.ok && j.connected) setConnected({ pageName: j.pageName, pageId: j.pageId })
      else setConnected(null)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  useEffect(() => { loadStatus() }, [])

  const submit = async () => {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/facebook/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: appId.trim(), appSecret: appSecret.trim(), userToken: userToken.trim() }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Connection failed')
      setConnected({ pageName: j.pageName, pageId: j.pageId })
      setAppSecret(''); setUserToken('')
    } catch (e: any) {
      setError(e?.message || 'Connection failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Facebook className="text-[#1877F2]" size={20} />
        <h1 className="text-base font-extrabold text-gray-800">Connect Facebook</h1>
      </div>

      {connected && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-3 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-green-600 flex-shrink-0" />
          <p className="text-xs font-semibold text-green-700">
            Connected to <b>{connected.pageName || 'your page'}</b>. Auto-posting is live — you can re-connect below if it ever stops working.
          </p>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-3 text-[11px] text-blue-800 font-medium leading-relaxed space-y-1.5">
        <p className="font-bold">Where to get the 3 values:</p>
        <p>1. <b>App ID</b> — already filled in below.</p>
        <p>2. <b>App Secret</b> — Meta dashboard → App settings → Basic → <i>Show</i>.</p>
        <p>3. <b>User token</b> — open the{' '}
          <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" className="underline font-bold inline-flex items-center gap-0.5">
            Graph API Explorer <ExternalLink size={10} />
          </a>{' '}
          → app <b>Emma Posts</b> → <b>User Token</b> → permissions <code>pages_show_list, pages_read_engagement, pages_manage_posts</code> → <b>Generate Access Token</b> → copy it.
        </p>
        <p className="text-blue-500">Done once. The CRM turns it into a permanent token automatically — no expiry.</p>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-3">
        <Field label="App ID" value={appId} onChange={setAppId} placeholder="1472466964898108" />
        <Field label="App Secret" value={appSecret} onChange={setAppSecret} placeholder="Paste the App Secret" type="password" />
        <div>
          <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1">User token</label>
          <textarea
            value={userToken}
            onChange={e => setUserToken(e.target.value)}
            placeholder="Paste the User token from the Graph API Explorer"
            rows={4}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-[11px] font-mono outline-none resize-none focus:border-pink-300 break-all"
          />
        </div>

        {error && <p className="text-[10px] font-semibold text-red-500 leading-snug">{error}</p>}

        <button
          onClick={submit}
          disabled={saving || !appId.trim() || !appSecret.trim() || !userToken.trim()}
          className="w-full bg-[#1877F2] text-white rounded-xl py-2.5 text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-40 active:scale-95 transition-all"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Facebook size={14} />}
          {connected ? 'Re-connect' : 'Connect & save permanent token'}
        </button>
        <p className="text-[9px] text-gray-400 text-center leading-snug">
          Your App Secret is used once to build the token and is never stored.
        </p>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div>
      <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium outline-none focus:border-pink-300"
      />
    </div>
  )
}
