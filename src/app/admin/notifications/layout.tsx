'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MessageSquare, Phone, History, Activity } from 'lucide-react'

const SUB_TABS = [
    {
        href: '/admin/notifications/sms-logs',
        icon: History,
        label: 'SMS Logs',
        description: 'Every SMS sent — handoffs, debits, failures',
    },
    {
        href: '/admin/notifications/cron-status',
        icon: Activity,
        label: 'Cron Status',
        description: 'Is the hourly debit cron running?',
    },
    {
        href: '/admin/notifications/worker-phones',
        icon: Phone,
        label: 'Worker Phones',
        description: 'Manage phone numbers and SMS opt-in',
    },
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

            {/* Page content */}
            <div>{children}</div>
        </div>
    )
}
