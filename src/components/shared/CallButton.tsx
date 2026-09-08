'use client'

// ============================================================================
// CallButton — drop next to any phone number in the CRM.
// ============================================================================
// Clicking does NOT navigate anywhere: it hands the number to the softphone
// dock in the dashboard layout, which dials over WebRTC. The agent stays on the
// page they were reading, which is the entire point — they can take notes while
// the phone is ringing.
//
//   <CallButton phone={customer.phone} customerId={customer.id} />
//
// Pass customerId / leadId so the call log knows what the call was about; the
// UCP event only carries the number.
// ============================================================================

import { Phone } from 'lucide-react'
import { placeCall } from '@/lib/ucp-client'

interface Props {
    phone: string
    customerId?: string
    leadId?: string
    /** Shown in the dock header while the call is live. */
    label?: string
    /** 'icon' for tight rows, 'full' for a labelled button. */
    variant?: 'icon' | 'full'
    className?: string
}

export default function CallButton({
    phone,
    customerId,
    leadId,
    label,
    variant = 'icon',
    className = '',
}: Props) {
    if (!phone) return null

    const dial = (e: React.MouseEvent) => {
        // These buttons sit inside cards and rows that are themselves clickable.
        e.preventDefault()
        e.stopPropagation()
        placeCall({ phone, customerId, leadId, label })
    }

    if (variant === 'full') {
        return (
            <button
                onClick={dial}
                title={`Call ${phone}`}
                className={`inline-flex items-center gap-1.5 text-[9px] font-bold text-green-700 bg-green-50 border border-green-200 px-2.5 py-1.5 rounded-lg hover:bg-green-100 transition-colors ${className}`}
            >
                <Phone size={9} /> Call
            </button>
        )
    }

    return (
        <button
            onClick={dial}
            title={`Call ${phone}`}
            aria-label={`Call ${phone}`}
            className={`inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-50 border border-green-200 text-green-600 hover:bg-green-100 transition-colors flex-shrink-0 ${className}`}
        >
            <Phone size={11} />
        </button>
    )
}
