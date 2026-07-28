'use client'

import { MessageSquare } from 'lucide-react'

// SMS Logs and Cron Status were removed; Worker Phones is the only page left
// here, so there is no sub-nav to render any more.
export default function NotificationsLayout({
    children,
}: {
    children: React.ReactNode
}) {
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

            {/* Page content */}
            <div>{children}</div>
        </div>
    )
}
