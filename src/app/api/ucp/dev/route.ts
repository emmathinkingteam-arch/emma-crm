// ============================================================================
// /api/ucp/dev — DEV ONLY, gated behind UCP_SIM=1
// ============================================================================
// Two things the simulator needs that the real platform provides:
//
//   ?action=attach-recording&callId=…  marks a call as having a recording,
//                                      pointing at the generator below. The
//                                      real system does this in the CDR cron.
//   ?action=recording                  returns a short WAV tone, so the audio
//                                      player in the History bar has something
//                                      real to play.
//
// Returns 404 unless UCP_SIM=1, so this is inert in production.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { currentProfile } from '@/lib/api-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const enabled = () => process.env.UCP_SIM === '1'

/** A 3-second 440Hz tone as a mono 8kHz WAV. Enough to prove the player works. */
function toneWav(seconds = 3, hz = 440, rate = 8000): Buffer {
    const samples = seconds * rate
    const data = Buffer.alloc(samples * 2)
    for (let i = 0; i < samples; i++) {
        // Fade the last half-second so it does not end on a click.
        const fade = Math.min(1, (samples - i) / (rate * 0.5))
        data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 8000 * fade), i * 2)
    }
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + data.length, 4)
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)      // PCM chunk size
    header.writeUInt16LE(1, 20)       // PCM
    header.writeUInt16LE(1, 22)       // mono
    header.writeUInt32LE(rate, 24)
    header.writeUInt32LE(rate * 2, 28)
    header.writeUInt16LE(2, 32)
    header.writeUInt16LE(16, 34)
    header.write('data', 36)
    header.writeUInt32LE(data.length, 40)
    return Buffer.concat([header, data])
}

export async function GET(req: NextRequest) {
    if (!enabled()) return new NextResponse('Not found', { status: 404 })

    const me = await currentProfile()
    if (!me) return new NextResponse('Unauthorized', { status: 401 })

    const action = req.nextUrl.searchParams.get('action')

    if (action === 'recording') {
        const wav = toneWav()
        // Buffer -> a fresh Uint8Array so it satisfies BodyInit.
        return new NextResponse(new Uint8Array(wav), {
            status: 200,
            headers: {
                'Content-Type': 'audio/wav',
                'Content-Length': String(wav.length),
                'Cache-Control': 'private, max-age=3600',
            },
        })
    }

    if (action === 'attach-recording') {
        const callId = req.nextUrl.searchParams.get('callId')
        if (!callId) return NextResponse.json({ error: 'callId required' }, { status: 400 })

        const sb = supabaseAdmin()
        const { data, error } = await sb
            .from('calls')
            .update({
                recording_id: 'SIMULATED',
                recording_url: '/api/ucp/dev?action=recording',
                recording_synced_at: new Date().toISOString(),
            })
            .eq('ucp_call_id', callId)
            .select('id')
            .maybeSingle()

        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ ok: true, id: data?.id ?? null })
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
