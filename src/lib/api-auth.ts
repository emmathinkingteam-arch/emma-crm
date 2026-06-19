// ============================================================================
// src/lib/api-auth.ts — SERVER-ONLY
// ============================================================================
// Resolve the *profile* (public.users row) for the current session.
//
// IMPORTANT: Supabase auth.getUser() returns the AUTH user id, which maps to
// users.auth_user_id — NOT users.id. The client/auth store uses users.id, so
// any API route that needs the caller's role or profile id must look it up via
// auth_user_id (the same way the login page does).
// ============================================================================

import { createSupabaseServerClient } from '@/lib/supabase-server'

export interface CurrentProfile {
    id: string // public.users.id (what the client/auth store uses)
    role: string
}

export async function currentProfile(): Promise<CurrentProfile | null> {
    try {
        const sb = createSupabaseServerClient()
        const { data: { user } } = await sb.auth.getUser()
        if (!user) return null
        const { data } = await sb
            .from('users')
            .select('id, role')
            .eq('auth_user_id', user.id)
            .single()
        return (data as CurrentProfile) ?? null
    } catch {
        return null
    }
}

export function isAdminRole(role: string | undefined | null): boolean {
    return role === 'admin' || role === 'ceo'
}
