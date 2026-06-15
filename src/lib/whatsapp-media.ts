// ============================================================================
// WhatsApp inbound media — download from Meta, transcribe, store for the panel
// ============================================================================

import { v2 as cloudinary } from 'cloudinary'
import { GEMINI_MODEL } from './gemini'

const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN!
const VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0'

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

export interface DownloadedMedia {
  buffer: Buffer
  mimeType: string
}

// ── Step 1: media id → temporary download URL ───────────────────────────────
export async function getMediaInfo(mediaId: string): Promise<{ url: string; mimeType: string } | null> {
  const res = await fetch(`https://graph.facebook.com/${VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  if (!res.ok) {
    console.error('[wa-media] getMediaInfo failed', res.status, await res.text())
    return null
  }
  const data = await res.json() as { url?: string; mime_type?: string }
  if (!data.url) return null
  return { url: data.url, mimeType: data.mime_type ?? 'application/octet-stream' }
}

// ── Step 2: download the actual bytes (needs the bearer token) ──────────────
export async function downloadMedia(mediaId: string): Promise<DownloadedMedia | null> {
  const info = await getMediaInfo(mediaId)
  if (!info) return null
  const res = await fetch(info.url, { headers: { Authorization: `Bearer ${TOKEN}` } })
  if (!res.ok) {
    console.error('[wa-media] download failed', res.status)
    return null
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  return { buffer, mimeType: info.mimeType }
}

// ── Transcribe a voice note ─────────────────────────────────────────────────
// Follows the active AI provider:
//   gemini → Gemini (inline audio), with Whisper as fallback if it fails
//   claude → OpenAI Whisper (Anthropic has no STT)
export async function transcribeAudio(
  media: DownloadedMedia,
  provider: 'claude' | 'gemini' | 'gpt' = 'claude',
): Promise<string | null> {
  if (provider === 'gemini' && process.env.GEMINI_API_KEY) {
    const out = await transcribeWithGemini(media)
    if (out !== null) return out
    // fall through to Whisper if Gemini returned nothing
  }
  return transcribeWithWhisper(media)
}

// ── OpenAI Whisper ──────────────────────────────────────────────────────────
async function transcribeWithWhisper(media: DownloadedMedia): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY
  if (!key) {
    console.error('[wa-media] OPENAI_API_KEY not set — cannot transcribe')
    return null
  }
  try {
    const form = new FormData()
    const ext = media.mimeType.includes('mpeg') ? 'mp3' : media.mimeType.includes('mp4') ? 'mp4' : 'ogg'
    form.append('file', new Blob([new Uint8Array(media.buffer)], { type: media.mimeType }), `voice.${ext}`)
    form.append('model', 'whisper-1')
    // no language pin — handles Sinhala/English/Singlish mix
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    })
    if (!res.ok) {
      console.error('[wa-media] whisper failed', res.status, await res.text())
      return null
    }
    const data = await res.json() as { text?: string }
    return (data.text ?? '').trim() || null
  } catch (e) {
    console.error('[wa-media] whisper error', e)
    return null
  }
}

// ── Gemini audio transcription (inline audio bytes) ─────────────────────────
async function transcribeWithGemini(media: DownloadedMedia): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY
  if (!key) return null
  try {
    // Gemini wants a bare audio mime type (no "; codecs=opus" suffix)
    const mimeType = media.mimeType.split(';')[0].trim() || 'audio/ogg'
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: media.buffer.toString('base64') } },
            { text: 'Transcribe this voice note verbatim. The speaker may mix Sinhala and English (Singlish). Output ONLY the transcript text, nothing else.' },
          ],
        }],
        generationConfig: { temperature: 0 },
      }),
    })
    if (!res.ok) {
      console.error('[wa-media] gemini transcribe failed', res.status, await res.text())
      return null
    }
    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map(p => p.text ?? '')
      .join('')
      .trim()
    return text || null
  } catch (e) {
    console.error('[wa-media] gemini transcribe error', e)
    return null
  }
}

// ── Store media in Cloudinary so the support panel can render it ────────────
export async function storeMedia(media: DownloadedMedia, folder: string, publicId: string): Promise<string | null> {
  try {
    const base64 = `data:${media.mimeType};base64,${media.buffer.toString('base64')}`
    const result = await cloudinary.uploader.upload(base64, {
      folder: `wa-media/${folder}`,
      public_id: publicId,
      overwrite: true,
      resource_type: 'auto',
    })
    return result.secure_url
  } catch (e) {
    console.error('[wa-media] cloudinary upload failed', e)
    return null
  }
}

// ── Convert image bytes to a Claude image block ─────────────────────────────
export function toClaudeImage(media: DownloadedMedia): {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string }
} {
  // Claude accepts jpeg/png/gif/webp
  let mt = media.mimeType
  if (!/^image\/(jpeg|png|gif|webp)$/.test(mt)) mt = 'image/jpeg'
  return {
    type: 'image',
    source: { type: 'base64', media_type: mt, data: media.buffer.toString('base64') },
  }
}
