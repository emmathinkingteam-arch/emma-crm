'use client'

// ============================================================================
// CrmTagButtons — the quick-status button grid used on every entry screen.
// ============================================================================
// Multi-select: the agent can tap several ("Package details sent" + "Call back
// later"). Selecting any negative tag (Not answer / Not interest / Reject /
// Fake) reveals an OPTIONAL reason box — if filled, it goes to the admin's
// Rejected CRM tab. Agents can skip it.
// ============================================================================

import { CRM_TAGS, negativeOf, type CrmTagKey } from '@/lib/crm-tags'

interface Props {
    selected: CrmTagKey[]
    onChange: (next: CrmTagKey[]) => void
    reason: string
    onReasonChange: (r: string) => void
}

export default function CrmTagButtons({ selected, onChange, reason, onReasonChange }: Props) {
    const toggle = (key: CrmTagKey) => {
        onChange(selected.includes(key) ? selected.filter((t) => t !== key) : [...selected, key])
    }

    const negatives = negativeOf(selected)

    return (
        <div>
            <div className="flex flex-wrap gap-1.5">
                {CRM_TAGS.map((t) => {
                    const on = selected.includes(t.key)
                    return (
                        <button
                            key={t.key}
                            type="button"
                            onClick={() => toggle(t.key)}
                            className={`px-2.5 py-2 rounded-xl text-[10px] font-bold border active:scale-95 transition-all ${on ? t.btnOn : t.btn}`}
                        >
                            {on ? '✓ ' : ''}{t.label}
                        </button>
                    )
                })}
            </div>

            {negatives.length > 0 && (
                <div className="mt-2 bg-gray-50 border border-gray-100 rounded-xl p-2.5">
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">
                        Reason (optional — can skip)
                    </p>
                    <textarea
                        value={reason}
                        onChange={(e) => onReasonChange(e.target.value)}
                        rows={2}
                        placeholder="Why? e.g. said too expensive / wrong number... (optional)"
                        className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:border-gray-400 resize-none leading-relaxed"
                    />
                </div>
            )}
        </div>
    )
}
