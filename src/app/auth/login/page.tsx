'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Loader2, Eye, EyeOff } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const { setUser } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) {
      setError('Invalid email or password. Please try again.')
      setLoading(false)
      return
    }

    if (data.user) {
      const { data: profile } = await supabase
        .from('users')
        .select('*')
        .eq('auth_user_id', data.user.id)
        .single()

      if (profile) {
        setUser(profile)
        await new Promise(r => setTimeout(r, 300))
        // Only confirmed admins go to /admin. Every other role — and any
        // case where the role is missing/unexpected — goes to /dashboard.
        // We never default an unknown user into the admin panel.
        if (profile.role === 'admin') {
          router.replace('/admin')
        } else {
          router.replace('/dashboard')
        }
      } else {
        // No profile row found: do not assume anything. Send to the worker
        // dashboard (the middleware will re-gate on the next navigation).
        router.replace('/dashboard')
      }
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-pink-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm animate-fade-up">

        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-pink-600 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-pink-200">
            <span className="text-white font-bold text-2xl">E</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Emma Thinking</h1>
          <p className="text-gray-400 text-sm font-medium mt-1">Worker Login</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl p-8 shadow-sm border border-pink-100">
          <form onSubmit={handleLogin} className="space-y-4">

            <div>
              <label className="block text-xs font-600 text-gray-400 uppercase tracking-wider mb-2">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@emmathinking.com"
                className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm font-medium text-gray-800 placeholder:text-gray-300 focus:border-pink-300 focus:bg-white transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-600 text-gray-400 uppercase tracking-wider mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm font-medium text-gray-800 placeholder:text-gray-300 focus:border-pink-300 focus:bg-white transition-all pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3 text-xs text-red-500 font-medium">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-pink-600 text-white font-semibold py-3.5 rounded-full shadow-lg shadow-pink-200 flex items-center justify-center gap-2 text-sm hover:bg-pink-700 active:scale-95 transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : 'Sign in →'}
            </button>
          </form>

          <div className="mt-6 bg-pink-50 rounded-2xl p-4 text-center">
            <p className="text-xs text-gray-400 font-medium leading-relaxed">
              Your device will stay signed in.<br />
              No need to log in every time.
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-gray-300 font-medium mt-6">
          Emma Thinking (Pvt) Ltd · Internal System
        </p>
      </div>
    </div>
  )
}
