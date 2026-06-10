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

export const PACKAGE_TONE: Record<string, PackageTone> = {
  bronze:   { bg: 'bg-amber-100',   border: 'border-amber-400',   text: 'text-amber-900',   dot: 'bg-amber-400',   chip: 'bg-amber-300 text-amber-900' },
  silver:   { bg: 'bg-slate-100',   border: 'border-slate-400',   text: 'text-slate-900',   dot: 'bg-slate-400',   chip: 'bg-slate-300 text-slate-900' },
  gold:     { bg: 'bg-yellow-100',  border: 'border-yellow-400',  text: 'text-yellow-900',  dot: 'bg-yellow-400',  chip: 'bg-yellow-300 text-yellow-900' },
  platinum: { bg: 'bg-cyan-100',    border: 'border-cyan-400',    text: 'text-cyan-900',    dot: 'bg-cyan-400',    chip: 'bg-cyan-300 text-cyan-900' },
  diamond:  { bg: 'bg-violet-100',  border: 'border-violet-400',  text: 'text-violet-900',  dot: 'bg-violet-400',  chip: 'bg-violet-300 text-violet-900' },
  vip:      { bg: 'bg-pink-100',    border: 'border-pink-400',    text: 'text-pink-900',    dot: 'bg-pink-400',    chip: 'bg-pink-300 text-pink-900' },
  elite:    { bg: 'bg-emerald-100', border: 'border-emerald-400', text: 'text-emerald-900', dot: 'bg-emerald-400', chip: 'bg-emerald-300 text-emerald-900' },
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
