// ============================================================================
// Facebook Page publishing — SERVER-ONLY
// ============================================================================
//
// Publishes (or schedules) a photo post to the Emma thinking Facebook Page via
// the Graph API. Used by /api/facebook/publish so the team can post straight
// from the CRM's Post Builder instead of Meta Business Suite.
//
// Required env vars (set in Vercel + .env.local):
//   FB_PAGE_ID             = the Facebook Page's numeric id (e.g. 108411837744318)
//   FB_PAGE_ACCESS_TOKEN   = a long-lived / permanent PAGE access token with
//                            pages_manage_posts + pages_read_engagement
//   FB_GRAPH_VERSION       = optional, defaults to v21.0
//
// The image lives in the PRIVATE B2 bucket, so Facebook can't fetch it by URL.
// We upload the raw bytes as the multipart `source` field instead.
// ============================================================================

const FB_PAGE_ID = process.env.FB_PAGE_ID
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN
const FB_GRAPH_VERSION = process.env.FB_GRAPH_VERSION || 'v21.0'

// Facebook requires scheduled posts to be 10 min – 6 months in the future.
const MIN_LEAD_MS = 10 * 60 * 1000
const MAX_LEAD_MS = 180 * 24 * 60 * 60 * 1000

export function facebookConfigured(): boolean {
  return Boolean(FB_PAGE_ID && FB_PAGE_ACCESS_TOKEN)
}

export interface PublishResult {
  id: string
  scheduled: boolean
  scheduledTime: string | null
}

/**
 * Publish or schedule a single-photo post on the Page.
 *
 * @param imageBytes  the artwork bytes
 * @param contentType e.g. "image/png"
 * @param caption     the full post text (Part 1)
 * @param when        ISO date string to schedule for; if null / <10 min away,
 *                    the post goes out immediately.
 */
export async function publishPhotoPost(
  imageBytes: Buffer,
  contentType: string,
  caption: string,
  when: string | null,
): Promise<PublishResult> {
  if (!facebookConfigured()) {
    throw new Error('Facebook is not configured (FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN missing).')
  }

  // Decide schedule vs publish-now.
  let scheduledUnix: number | null = null
  if (when) {
    const t = new Date(when).getTime()
    if (!Number.isNaN(t)) {
      const lead = t - Date.now()
      if (lead > MAX_LEAD_MS) {
        throw new Error('Schedule date is more than 6 months away — Facebook will not accept it.')
      }
      if (lead >= MIN_LEAD_MS) scheduledUnix = Math.floor(t / 1000)
      // lead < 10 min → fall through to publish immediately
    }
  }

  const form = new FormData()
  form.append('access_token', FB_PAGE_ACCESS_TOKEN!)
  form.append('caption', caption)
  if (scheduledUnix) {
    form.append('published', 'false')
    form.append('scheduled_publish_time', String(scheduledUnix))
  } else {
    form.append('published', 'true')
  }
  form.append('source', new Blob([new Uint8Array(imageBytes)], { type: contentType || 'image/png' }), 'post.png')

  const url = `https://graph.facebook.com/${FB_GRAPH_VERSION}/${FB_PAGE_ID}/photos`
  const res = await fetch(url, { method: 'POST', body: form })
  const json = await res.json().catch(() => ({}))

  if (!res.ok) {
    const msg = json?.error?.message || `Facebook publish failed (HTTP ${res.status})`
    throw new Error(msg)
  }

  return {
    id: json.post_id || json.id || '',
    scheduled: Boolean(scheduledUnix),
    scheduledTime: scheduledUnix ? new Date(scheduledUnix * 1000).toISOString() : null,
  }
}
