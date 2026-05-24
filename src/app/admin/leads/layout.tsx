'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Send, History, Megaphone } from 'lucide-react'

const SUB_TABS = [
    {
        href: '/admin/leads/assign',
        icon: Send,
        label: 'Assign Leads',
    },
    {
        href: '/admin/leads/history',
        icon: History,
        label: 'History',
    },
]

export default function LeadsLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname()

    return (
        <div className="p-6 max-w-6xl">
            {/* Section header */}
            <div className="mb-5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-pink-100 flex items-center justify-center">
                    <Megaphone size={16} className="text-pink-600" />
                </div>
                <div>
                    <h1 className="text-xl font-bold text-gray-800">Lead Distribution</h1>
                    <p className="text-[10px] text-gray-400 font-medium">
                        Assign calling numbers to agents · drip-fed · punch-gated · auto-penalty
                    </p>
                </div>
            </div>

            {/* Sub-nav tabs */}
            <div className="bg-white rounded-2xl border border-gray-100 p-1.5 mb-5 inline-flex gap-1 shadow-sm">
                {SUB_TABS.map(({ href, icon: Icon, label }) => {
                    const active = pathname === href
                    return (
                        <Link
                            key={href}
                            href={href}
                            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${active
                                ? 'bg-pink-600 text-white shadow-sm'
                                : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'
                                }`}
                        >
                            <Icon size={13} />
                            {label}
                        </Link>
                    )
                })}
            </div>

            <div>{children}</div>
        </div>
    )
}
