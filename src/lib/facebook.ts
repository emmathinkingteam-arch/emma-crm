// ============================================================================
// Facebook Page publishing — SERVER-ONLY
// ============================================================================
//
// Publishes (or schedules) a photo post to the Emma thinking Facebook Page via
// the Graph API. Used by /api/facebook/publish so the team can post straight
// from the CRM's Post Builder instead of Meta Business Suite.
//
// Credentials (page id + permanent page access token) are stored in the
// `facebook_settings` DB row, written by /api/facebook/connect. If that row is
// empty we fall back to env vars (FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN) so an
// advanced setup still works.
//
// The image lives in the PRIVATE B2 bucket, so Facebook can't fetch it by URL.
// We upload the raw bytes as the multipart `source` field instead.
// ============================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'

export const FB_GRAPH_VERSION = process.env.FB_GRAPH_VERSION || 'v21.0'

// Facebook requires scheduled posts to be 10 min – 6 months in the future.
const MIN_LEAD_MS = 10 * 60 * 1000
const MAX_LEAD_MS = 180 * 24 * 60 * 60 * 1000

export interface FacebookCredentials {
  pageId: string
  pageName: string | null
  token: string
}

/**
 * Load the connected Page id + token. Prefers the DB row (set via the in-app
 * "Connect Facebook" flow), falls back to env vars. Returns null if neither.
 */
export async function getFacebookCredentials(): Promise<FacebookCredentials | null> {
  try {
    const { data } = await supabaseAdmin()
      .from('facebook_settings')
      .select('page_id, page_name, page_access_token')
      .eq('id', 1)
      .single()
    if (data?.page_id && data?.page_access_token) {
      return { pageId: data.page_id, pageName: data.page_name ?? null, token: data.page_access_token }
    }
  } catch {
    // table/row missing — fall through to env
  }
  if (process.env.FB_PAGE_ID && process.env.FB_PAGE_ACCESS_TOKEN) {
    return { pageId: process.env.FB_PAGE_ID, pageName: null, token: process.env.FB_PAGE_ACCESS_TOKEN }
  }
  return null
}

export interface PublishResult {
  id: string
  scheduled: boolean
  scheduledTime: string | null
}

/**
 * Publish or schedule a single-photo post on the Page.
 *
 * @param creds       page id + access token from getFacebookCredentials()
 * @param imageBytes  the artwork bytes
 * @param contentType e.g. "image/png"
 * @param caption     the full post text (Part 1)
 * @param when        ISO date string to schedule for; if null / <10 min away,
 *                    the post goes out immediately.
 */
export async function publishPhotoPost(
  creds: FacebookCredentials,
  imageBytes: Buffer,
  contentType: string,
  caption: string,
  when: string | null,
): Promise<PublishResult> {
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
  form.append('access_token', creds.token)
  form.append('caption', caption)
  if (scheduledUnix) {
    form.append('published', 'false')
    form.append('scheduled_publish_time', String(scheduledUnix))
  } else {
    form.append('published', 'true')
  }
  form.append('source', new Blob([new Uint8Array(imageBytes)], { type: contentType || 'image/png' }), 'post.png')

  const url = `https://graph.facebook.com/${FB_GRAPH_VERSION}/${creds.pageId}/photos`
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
