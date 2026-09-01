// ============================================================================
// readJson — turn any fetch Response into JSON, or a readable Error.
// ============================================================================
//
// Calling `await res.json()` straight on a fetch is fine until the route isn't
// there (or Next renders its error page, or a proxy times out). Then the body
// is HTML and the browser throws
//     Unexpected token '<', "<!DOCTYPE "... is not valid JSON
// which tells back office nothing about what actually broke.
//
// This reads the body ONCE as text, parses it when it is JSON, and otherwise
// raises the real reason ("This feature is missing on the server (404)…").
// Use it for every staff-facing fetch that expects JSON back.
// ============================================================================

export async function readJson<T = any>(res: Response, what = 'Request'): Promise<T> {
    const raw = await res.text()

    let data: any = null
    if (raw) {
        try { data = JSON.parse(raw) } catch { /* HTML / plain text */ }
    }

    // Proper JSON came back — let the caller decide what a non-OK body means.
    if (data !== null && typeof data === 'object') {
        if (!res.ok) throw new Error(data.error || data.message || `${what} failed (${res.status})`)
        return data as T
    }

    if (res.ok) {
        // 200 with a non-JSON body: almost always a login redirect served as HTML.
        throw new Error(`${what} returned an unexpected response — please sign in again and retry.`)
    }

    if (res.status === 404) {
        throw new Error(`${what} failed — this feature is missing on the server (404). It needs to be deployed.`)
    }
    if (res.status === 401 || res.status === 403) {
        throw new Error(`${what} failed — you are not signed in, or your role is not allowed (${res.status}).`)
    }
    if (res.status === 413) {
        throw new Error(`${what} failed — the file is too large.`)
    }

    // Anything else: show the first line of the body if it reads like a message.
    const snippet = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140)
    throw new Error(
        snippet && !/^\s*$/.test(snippet)
            ? `${what} failed (${res.status}): ${snippet}`
            : `${what} failed (${res.status}).`
    )
}
