'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MessageSquare } from 'lucide-react'

const TABS = [
    { href: '/admin/notifications/worker-phones', label: 'Worker Phones' },
    { href: '/admin/notifications/signups', label: 'Sign-up Alerts' },
]

export default function NotificationsLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const pathname = usePathname()
    return (
        <div className="p-6 max-w-6xl">
            {/* Section header */}
            <div className="mb-5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-pink-100 flex items-center justify-center">
                    <MessageSquare size={16} className="text-pink-600" />
                </div>
                <div>
                    <h1 className="text-xl font-bold text-gray-800">Notifications</h1>
                    <p className="text-[10px] text-gray-400 font-medium">
                        SMS to workers · Text.lk · sender &quot;Emma Love&quot;
                    </p>
                </div>
            </div>

            <div className="flex gap-1 mb-5 border-b border-gray-100">
                {TABS.map((t) => {
                    const active = pathname?.startsWith(t.href)
                    return (
                        <Link
                            key={t.href}
                            href={t.href}
                            className={`px-4 py-2 text-xs font-bold -mb-px border-b-2 transition-colors ${active
                                ? 'border-pink-600 text-pink-600'
                                : 'border-transparent text-gray-400 hover:text-gray-600'
                                }`}
                        >
                            {t.label}
                        </Link>
                    )
                })}
            </div>

            {/* Page content */}
            <div>{children}</div>
        </div>
    )
}
