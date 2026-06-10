// ── Shared package-tier colour palette ──────────────────────────────
// Single source of truth for how each package tier is coloured across the
// app (the FR PLAN calendar grid and the in-customer plan planner table).
// Match is on the lowercase, trimmed `packages.name`. Add or rename keys
// here if your package names change — both tables update together.

export type PackageTone = { bg: string; border: string; text: string; chip: string }

export const PACKAGE_TONE: Record<string, PackageTone> = {
  bronze:   { bg: 'bg-amber-50',  border: 'border-amber-400',  text: 'text-amber-900',  chip: 'bg-amber-200 text-amber-900' },
  silver:   { bg: 'bg-slate-50',  border: 'border-slate-400',  text: 'text-slate-900',  chip: 'bg-slate-200 text-slate-900' },
  gold:     { bg: 'bg-yellow-50', border: 'border-yellow-500', text: 'text-yellow-900', chip: 'bg-yellow-200 text-yellow-900' },
  platinum: { bg: 'bg-cyan-50',   border: 'border-cyan-500',   text: 'text-cyan-900',   chip: 'bg-cyan-200 text-cyan-900' },
  diamond:  { bg: 'bg-violet-50', border: 'border-violet-500', text: 'text-violet-900', chip: 'bg-violet-200 text-violet-900' },
  vip:      { bg: 'bg-pink-50',   border: 'border-pink-500',   text: 'text-pink-900',   chip: 'bg-pink-200 text-pink-900' },
  elite:    { bg: 'bg-emerald-50', border: 'border-emerald-500', text: 'text-emerald-900', chip: 'bg-emerald-200 text-emerald-900' },
}

export const PACKAGE_TONE_FALLBACK: PackageTone = {
  bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-900', chip: 'bg-blue-200 text-blue-900',
}

// Expired plans are greyed out regardless of package.
export const EXPIRED_TONE: PackageTone = {
  bg: 'bg-gray-100', border: 'border-gray-200', text: 'text-gray-400', chip: 'bg-gray-200 text-gray-400',
}

export function packageTone(name?: string | null): PackageTone {
  if (!name) return PACKAGE_TONE_FALLBACK
  return PACKAGE_TONE[name.trim().toLowerCase()] ?? PACKAGE_TONE_FALLBACK
}
