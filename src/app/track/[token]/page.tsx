import { createClient } from '@supabase/supabase-js'
import Tracker, { type Milestone, type ParsedBrief, type MState } from './Tracker'

// Plain anon client (no cookies) so the page is open to any visitor with
// the link. Data comes from the SECURITY DEFINER function get_order_tracking,
// which returns only whitelisted, name-free fields.
const publicSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
)

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Props { params: { token: string } }

const fmt = (d?: string | null) =>
    d ? new Date(d).toLocaleString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo',
    }) : null

const fmtDay = (d?: string | null) =>
    d ? new Date(d).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Colombo',
    }) : null

// Parse the counselling brief into gender + chips + headline + body. The brief
// is free-text the counsellor wrote, roughly:
//   38 | Male
//   Kollupitiya
//   Muslim
//   Pilot
//
//   The Modern Aviator   <- catchy headline
//
//   <descriptive paragraph...>
function parseBrief(raw?: string | null): ParsedBrief | null {
    if (!raw || !raw.trim()) return null
    const blocks = raw.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
    const headerLines = (blocks[0] || '').split('\n').map((s) => s.trim()).filter(Boolean)
    const first = (headerLines[0] || '')
    const gender: 'male' | 'female' | null =
        /female|woman|girl|bride/i.test(first) ? 'female'
            : /\bmale\b|\bman\b|groom/i.test(first) ? 'male'
                : null
    // Chips: split the first header line on "|" then add the remaining header lines.
    const chips = [
        ...first.split('|').map((s) => s.trim()).filter(Boolean),
        ...headerLines.slice(1),
    ].filter(Boolean).slice(0, 6)
    const headline = blocks[1] || null
    const body = blocks.length > 2 ? blocks.slice(2).join('\n\n') : null
    return { gender, chips, headline, body }
}

export default async function TrackPage({ params }: Props) {
    const { data } = await publicSupabase.rpc('get_order_tracking', { p_token: params.token })
    const t = data as any

    if (!t || !t.found) {
        return (
            <div className="min-h-screen bg-gradient-to-b from-pink-50 to-white flex items-center justify-center p-6">
                <div className="bg-white rounded-3xl shadow-sm p-8 max-w-sm w-full text-center">
                    <div className="w-14 h-14 rounded-2xl bg-pink-50 mx-auto mb-4 flex items-center justify-center">
                        <span className="text-2xl">🔎</span>
                    </div>
                    <h1 className="text-lg font-bold text-gray-800 mb-1">Order not found</h1>
                    <p className="text-sm text-gray-500">This tracking link may be invalid or has been removed.</p>
                    <p className="mt-6 text-xs font-bold tracking-wide" style={{ color: '#EA1E63' }}>EMMA THINKING</p>
                </div>
            </div>
        )
    }

    const now = Date.now()
    const isExpired = !!(t.expires_at && new Date(t.expires_at).getTime() < now)
    const isLive = !!t.published_at && !isExpired

    const stepMap = new Map<number, any>()
        ; (t.steps || []).forEach((s: any) => stepMap.set(s.step_number, s))

    const milestones: Milestone[] = []

    milestones.push({
        title: 'Order received',
        subtitle: 'We received your order and payment',
        at: fmt(t.created_at),
        state: 'done',
    })

    const stepDefs: { n: number; title: string; subtitle: string; extra?: 'brief' | 'design' }[] = [
        { n: 3, title: 'Onboarding', subtitle: 'Your profile journey began' },
        { n: 4, title: 'Counselling session', subtitle: 'Your profile consultation', extra: 'brief' },
        { n: 5, title: 'Profile review', subtitle: 'Content reviewed & approved' },
        { n: 6, title: 'Design & production', subtitle: 'Your profile post was prepared', extra: 'design' },
    ]
    for (const d of stepDefs) {
        const s = stepMap.get(d.n)
        const done = !!s?.done
        const active = !done && t.current_step === d.n
        const state: MState = done ? 'done' : active ? 'active' : 'upcoming'
        milestones.push({
            title: d.title,
            subtitle: d.subtitle,
            at: fmt(s?.completed_at || s?.started_at),
            state,
            extra: d.extra,
        })
    }

    if (t.planned_post_date) {
        milestones.push({
            title: 'Post scheduled',
            subtitle: (t.post_codes && t.post_codes.length)
                ? `Reference: ${t.post_codes.join(', ')}`
                : 'Your profile post is scheduled',
            at: fmtDay(t.planned_post_date),
            state: t.published_at ? 'done' : 'active',
        })
    }
    if (t.published_at) {
        milestones.push({
            title: 'Your profile is live',
            subtitle: 'Your post has been published',
            at: fmt(t.published_at),
            state: 'done',
        })
    }

    const statusBadge = isExpired
        ? { label: 'Expired', cls: 'bg-gray-100 text-gray-500' }
        : isLive
            ? { label: 'Live', cls: 'bg-green-100 text-green-700' }
            : { label: 'In progress', cls: 'bg-pink-100 text-pink-700' }

    const brief = parseBrief(t.brief)
    const designReady = !!t.post_image_url

    return (
        <Tracker
            token={params.token}
            customerName={t.customer_name || ''}
            customerPhone={t.customer_phone || ''}
            packageName={t.package_name || ''}
            invoiceNumber={t.invoice_number || ''}
            isLive={isLive}
            isExpired={isExpired}
            statusLabel={statusBadge.label}
            statusCls={statusBadge.cls}
            milestones={milestones}
            brief={brief}
            designReady={designReady}
        />
    )
}
