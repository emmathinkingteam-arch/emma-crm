// ============================================================================
// Shared Next.js cache tags
// ============================================================================
// Route handlers can't export arbitrary constants (Next only allows GET/POST/
// dynamic/revalidate/…), so tag names live here and are imported by both the
// route that CACHES with the tag and the routes that INVALIDATE it.
// ============================================================================

// /api/low-interest-alerts — the expensive "active posts × website interest"
// join. Invalidated by /api/low-interest-alerts/repost so the "Reposted" mark
// shows up immediately instead of after the TTL.
export const LOW_INTEREST_TAG = 'low-interest-alerts'
