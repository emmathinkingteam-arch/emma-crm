// ============================================================================
// "Posts Api" folder access — CLIENT ONLY.
//
// Lets the designer's browser read the Illustrator export straight out of the
// local folder (e.g. ~/Downloads/Posts Api) using the File System Access API.
// The user grants the folder once; we cache the directory handle in IndexedDB
// and re-request permission on later visits, so the AI button can find the file
// whose name matches the post code and upload it.
//
// Only Chromium browsers (Chrome / Edge) support this. Callers must feature-
// detect with `supportsFolderAccess()` and fall back to a plain <input type=file>
// (Safari / Firefox).
// ============================================================================

const DB_NAME = 'emma-posts-api'
const STORE = 'handles'
const KEY = 'posts-folder'

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif']

export function supportsFolderAccess(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
    tx.onsuccess = () => resolve(tx.result as T)
    tx.onerror = () => reject(tx.error)
  })
}

async function idbSet(key: string, val: unknown): Promise<void> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite').objectStore(STORE).put(val, key)
    tx.onsuccess = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

type Handle = any // FileSystemDirectoryHandle — typed loosely for older TS libs

async function ensurePermission(handle: Handle): Promise<boolean> {
  const opts = { mode: 'read' as const }
  if ((await handle.queryPermission?.(opts)) === 'granted') return true
  return (await handle.requestPermission?.(opts)) === 'granted'
}

/** Prompt the user to pick their "Posts Api" folder and remember it. */
export async function pickPostsFolder(): Promise<boolean> {
  const picker = (window as any).showDirectoryPicker
  if (typeof picker !== 'function') throw new Error('This browser cannot open folders. Use Chrome or Edge.')

  // NOTE: the picker `id` may only contain letters, numbers and underscores —
  // a hyphen here makes Chromium throw "The string did not match the expected
  // pattern." So we use an alphanumeric id, and still fall back to calling the
  // picker with no options if any build rejects the options object.
  let handle: Handle
  try {
    handle = await picker({ id: 'emmapostsapi', mode: 'read' })
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e          // user cancelled — bubble up
    handle = await picker()                         // retry without options
  }
  if (!handle) return false
  try { await idbSet(KEY, handle) } catch { /* remembering is best-effort */ }
  return ensurePermission(handle)
}

/** Get the remembered folder handle, re-confirming permission. Null if none. */
export async function getPostsFolder(): Promise<Handle | null> {
  const handle = await idbGet<Handle>(KEY)
  if (!handle) return null
  return (await ensurePermission(handle)) ? handle : null
}

export async function hasPostsFolder(): Promise<boolean> {
  return Boolean(await idbGet<Handle>(KEY))
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '').toLowerCase()
}

function isImage(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXT.includes(ext)
}

// Collapse a name to just its letters/digits so different separators or casing
// (L/26/R, L-26-R, "L 26 R", l_26_r) all compare equal.
function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Find the image file in the folder whose name matches `code` (ignoring
 * extension, case and separators). Prefers an exact base-name match, then
 * falls back to a normalized match. Returns the File, or null if not found.
 */
export async function findDesignFile(handle: Handle, code: string): Promise<File | null> {
  const wantExact = code.toLowerCase()
  const wantNorm = normalize(code)
  let fallback: any = null
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== 'file' || !isImage(name)) continue
    if (baseName(name) === wantExact) return entry.getFile()
    if (!fallback && normalize(baseName(name)) === wantNorm) fallback = entry
  }
  return fallback ? fallback.getFile() : null
}
