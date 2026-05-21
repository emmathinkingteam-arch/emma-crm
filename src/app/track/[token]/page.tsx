import { createClient } from '@supabase/supabase-js'

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

type MState = 'done' | 'active' | 'upcoming'

const fmt = (d?: string | null) =>
    d ? new Date(d).toLocaleString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo',
    }) : null

const fmtDay = (d?: string | null) =>
    d ? new Date(d).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Colombo',
    }) : null

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

    const milestones: { title: string; subtitle: string; at: string | null; state: MState }[] = []

    milestones.push({
        title: 'Order received',
        subtitle: 'We received your order and payment',
        at: fmt(t.created_at),
        state: 'done',
    })

    const stepDefs = [
        { n: 3, title: 'Onboarding', subtitle: 'Your profile journey began' },
        { n: 4, title: 'Counselling session', subtitle: 'Your profile consultation' },
        { n: 5, title: 'Profile review', subtitle: 'Content reviewed & approved' },
        { n: 6, title: 'Design & production', subtitle: 'Your profile post was prepared' },
    ]
    for (const d of stepDefs) {
        const s = stepMap.get(d.n)
        const done = !!s?.done
        const active = !done && t.current_step === d.n
        milestones.push({
            title: d.title,
            subtitle: d.subtitle,
            at: fmt(s?.completed_at || s?.started_at),
            state: done ? 'done' : active ? 'active' : 'upcoming',
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

    return (
        <div className="min-h-screen bg-gradient-to-b from-pink-50 via-white to-white">
            <div className="max-w-md mx-auto px-4 pb-12">

                {/* Brand header */}
                <div className="pt-8 pb-6 text-center">
                    <div
                        className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3 shadow-sm"
                        style={{ background: '#EA1E63' }}
                    >
                        <span className="text-white text-xl font-extrabold">E</span>
                    </div>
                    <p className="text-sm font-extrabold tracking-wide" style={{ color: '#EA1E63' }}>EMMA THINKING</p>
                    <p className="text-[11px] text-gray-400 font-medium mt-0.5">Order Tracking</p>
                </div>

                {/* Summary card */}
                <div className="bg-white rounded-3xl shadow-sm border border-pink-50 overflow-hidden">
                    <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-lg font-bold text-gray-800 truncate">{t.customer_name || 'Valued Customer'}</p>
                            <p className="text-sm text-gray-400 font-medium">{t.customer_phone || ''}</p>
                        </div>
                        <span className={`text-[10px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-full flex-shrink-0 ${statusBadge.cls}`}>
                            {statusBadge.label}
                        </span>
                    </div>
                    <div className="grid grid-cols-2 gap-px bg-gray-100">
                        <div className="bg-white px-5 py-3">
                            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Package</p>
                            <p className="text-sm font-bold text-gray-700 mt-0.5 truncate">{t.package_name || '—'}</p>
                        </div>
                        <div className="bg-white px-5 py-3">
                            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Invoice</p>
                            <p className="text-sm font-bold text-gray-700 mt-0.5">{t.invoice_number || '—'}</p>
                        </div>
                    </div>
                </div>

                {/* Expired banner */}
                {isExpired && (
                    <div className="mt-4 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-center">
                        <p className="text-sm font-bold text-gray-600">This campaign has expired</p>
                        {t.expires_at && (
                            <p className="text-xs text-gray-400 font-medium mt-0.5">Expired on {fmtDay(t.expires_at)}</p>
                        )}
                    </div>
                )}

                {/* Timeline */}
                <div className="mt-5 bg-white rounded-3xl shadow-sm border border-pink-50 p-5">
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-4">Progress</p>
                    <div className="relative">
                        {milestones.map((m, i) => {
                            const last = i === milestones.length - 1
                            const dotColor =
                                m.state === 'done' ? '#EA1E63'
                                    : m.state === 'active' ? '#FF92BA'
                                        : '#E5E7EB'
                            return (
                                <div key={i} className="flex gap-3.5 relative">
                                    {/* connector line */}
                                    {!last && (
                                        <span
                                            className="absolute left-[11px] top-6 w-0.5 h-full"
                                            style={{ background: m.state === 'done' ? '#FCD2E3' : '#F1F1F3' }}
                                        />
                                    )}
                                    {/* dot */}
                                    <div className="flex-shrink-0 mt-0.5">
                                        <div
                                            className="w-6 h-6 rounded-full flex items-center justify-center"
                                            style={{ background: dotColor }}
                                        >
                                            {m.state === 'done'
                                                ? <span className="text-white text-[12px] font-bold leading-none">✓</span>
                                                : m.state === 'active'
                                                    ? <span className="w-2 h-2 rounded-full bg-white" />
                                                    : <span className="w-2 h-2 rounded-full bg-gray-300" />}
                                        </div>
                                    </div>
                                    {/* content */}
                                    <div className={`pb-6 ${last ? 'pb-0' : ''} flex-1 min-w-0`}>
                                        <p className={`text-sm font-bold ${m.state === 'upcoming' ? 'text-gray-300' : 'text-gray-800'}`}>
                                            {m.title}
                                        </p>
                                        <p className={`text-xs font-medium ${m.state === 'upcoming' ? 'text-gray-300' : 'text-gray-500'}`}>
                                            {m.subtitle}
                                        </p>
                                        {m.at && m.state !== 'upcoming' && (
                                            <p className="text-[11px] text-gray-400 font-medium mt-0.5">{m.at}</p>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>

                <p className="text-center text-[11px] text-gray-300 font-medium mt-8">
                    Emma Thinking (Pvt) Ltd · Need help? Message your relationship manager.
                </p>
            </div>
        </div>
    )
}
