'use client'

// ============================================================================
// WebsiteLinksCard — square tiles for each emmathinking.com page. Tap one and
// WhatsApp opens with a short message + the link; the send is logged to the
// customer's history (the parent's onSent). A tile shows ×N once it has been
// sent to this customer before.
// ============================================================================

import { Globe } from 'lucide-react'
import { buildWaLink, openWaLink } from '@/lib/utils'
import { WEBSITE_LINKS, websiteLinkMessage, type WebsiteLink } from '@/lib/website-links'

interface Props {
  customerName?: string | null
  customerPhone: string
  /** How many times each link label has already been sent to this customer. */
  sentCounts?: Record<string, number>
  /** Called after WhatsApp opens so the parent can log it to history. */
  onSent: (link: WebsiteLink) => void
}

export default function WebsiteLinksCard({ customerName, customerPhone, sentCounts = {}, onSent }: Props) {
  const send = (link: WebsiteLink) => {
    // openWaLink must run before any await or mobile browsers block the tab.
    openWaLink(buildWaLink(customerPhone, websiteLinkMessage(customerName || customerPhone, link)))
    onSent(link)
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-3">
      <div className="flex items-center gap-2.5 mb-2">
        <Globe size={14} className="text-pink-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-gray-800">Website links</p>
          <p className="text-[9px] text-gray-400 font-medium">Tap a square to WhatsApp that page to the customer</p>
        </div>
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
        {WEBSITE_LINKS.map(link => {
          const n = sentCounts[link.label] || 0
          return (
            <button
              key={link.key}
              onClick={() => send(link)}
              title={link.url}
              className={`relative h-11 flex flex-col items-center justify-center gap-0.5 rounded-lg border px-0.5 text-center transition-colors ${n > 0
                ? 'bg-green-50 border-green-200 hover:bg-green-100'
                : 'bg-gray-50 border-gray-100 hover:bg-pink-50 hover:border-pink-200'}`}
            >
              <span className="text-sm leading-none">{link.emoji}</span>
              <span className="text-[8px] font-bold text-gray-700 leading-[1.1] line-clamp-2">{link.label}</span>
              {n > 0 && (
                <span className="absolute top-0.5 right-1 text-[7px] font-bold text-green-700">✓{n > 1 ? n : ''}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
