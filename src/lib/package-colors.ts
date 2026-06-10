// ── Shared package-tier colour palette ──────────────────────────────
// Single source of truth for how each package tier is coloured across the
// app (the FR PLAN calendar grid and the in-customer plan planner table).
// Match is on the lowercase, trimmed `packages.name`. Add or rename keys
// here if your package names change — both tables update together.
//
// Design: grid CELLS get a soft light tint (`bg`) with the tier's coloured
// ring (`border`) — clean and easy to read, like the legend. The LEGEND
// swatches use the solid `dot` colour. `chip` is the small package badge.

export type PackageTone = {
  bg: string      // soft light cell fill
  border: string  // coloured ring around the cell
  text: string    // readable text on the soft fill
  dot: string     // solid swatch colour (legend dots)
  chip: string    // small package-name badge
}

// IMPORTANT: `princess` is listed FIRST so that names like "Princess Gold"
// or "Princess VIP" resolve to the single Princess (pink) colour rather
// than gold/vip — the keyword match below checks keys in this order.
export const PACKAGE_TONE: Record<string, PackageTone> = {
  princess: { bg: 'bg-pink-100',    border: 'border-pink-300',    text: 'text-pink-700',    dot: 'bg-pink-500',    chip: 'bg-pink-200 text-pink-700' },
  vip:      { bg: 'bg-violet-100',  border: 'border-violet-300',  text: 'text-violet-700',  dot: 'bg-violet-500',  chip: 'bg-violet-200 text-violet-700' },
  platinum: { bg: 'bg-cyan-100',    border: 'border-cyan-300',    text: 'text-cyan-700',    dot: 'bg-cyan-500',    chip: 'bg-cyan-200 text-cyan-700' },
  gold:     { bg: 'bg-amber-100',   border: 'border-amber-300',   text: 'text-amber-700',   dot: 'bg-amber-500',   chip: 'bg-amber-200 text-amber-800' },
  silver:   { bg: 'bg-slate-100',   border: 'border-slate-300',   text: 'text-slate-600',   dot: 'bg-slate-400',   chip: 'bg-slate-200 text-slate-700' },
  bronze:   { bg: 'bg-orange-100',  border: 'border-orange-300',  text: 'text-orange-700',  dot: 'bg-orange-500',  chip: 'bg-orange-200 text-orange-800' },
  diamond:  { bg: 'bg-sky-100',     border: 'border-sky-300',     text: 'text-sky-700',     dot: 'bg-sky-500',     chip: 'bg-sky-200 text-sky-700' },
  elite:    { bg: 'bg-emerald-100', border: 'border-emerald-300', text: 'text-emerald-700', dot: 'bg-emerald-500', chip: 'bg-emerald-200 text-emerald-700' },
}

export const PACKAGE_TONE_FALLBACK: PackageTone = {
  bg: 'bg-blue-100', border: 'border-blue-400', text: 'text-blue-900', dot: 'bg-blue-400', chip: 'bg-blue-300 text-blue-900',
}

// Expired plans are greyed out regardless of package.
export const EXPIRED_TONE: PackageTone = {
  bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-400', dot: 'bg-gray-300', chip: 'bg-gray-200 text-gray-500',
}

// Real package names are things like "Gold Pass", "Princess Silver",
// "VIP Pass" — NOT bare "gold"/"silver". So we match by the tier KEYWORD
// found inside the name. The tier keywords never overlap as substrings,
// so the order of checking doesn't matter.
export function packageTone(name?: string | null): PackageTone {
  if (!name) return PACKAGE_TONE_FALLBACK
  const n = name.trim().toLowerCase()
  // Exact match wins (e.g. a package literally named "gold").
  if (PACKAGE_TONE[n]) return PACKAGE_TONE[n]
  // Otherwise find the tier keyword contained in the name.
  for (const key of Object.keys(PACKAGE_TONE)) {
    if (n.includes(key)) return PACKAGE_TONE[key]
  }
  return PACKAGE_TONE_FALLBACK
}
