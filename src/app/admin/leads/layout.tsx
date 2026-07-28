'use client'

import { Megaphone } from 'lucide-react'

// History and Meta Ads were removed; Assign Leads is the only page left here,
// so there is no sub-nav to render any more.
export default function LeadsLayout({ children }: { children: React.ReactNode }) {
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

            <div>{children}</div>
        </div>
    )
}
