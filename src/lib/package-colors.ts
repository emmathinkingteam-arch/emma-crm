// ── Shared package-tier colour palette ──────────────────────────────
// Single source of truth for how each package tier is coloured across the
// app (the FR PLAN calendar grid and the in-customer plan planner table).
// Match is on the lowercase, trimmed `packages.name`. Add or rename keys
// here if your package names change — both tables update together.

export type PackageTone = { bg: string; border: string; text: string; chip: string }

// Same hues as before, but with stronger (-200) fills so every tier is
// clearly distinguishable at a glance in the calendar / planner grids —
// the pale -50 fills all read as near-white ("only 2 colours").
export const PACKAGE_TONE: Record<string, PackageTone> = {
  bronze:   { bg: 'bg-amber-200',   border: 'border-amber-500',   text: 'text-amber-900',   chip: 'bg-amber-400 text-amber-950' },
  silver:   { bg: 'bg-slate-200',   border: 'border-slate-500',   text: 'text-slate-900',   chip: 'bg-slate-400 text-slate-950' },
  gold:     { bg: 'bg-yellow-200',  border: 'border-yellow-500',  text: 'text-yellow-900',  chip: 'bg-yellow-400 text-yellow-950' },
  platinum: { bg: 'bg-cyan-200',    border: 'border-cyan-500',    text: 'text-cyan-900',    chip: 'bg-cyan-400 text-cyan-950' },
  diamond:  { bg: 'bg-violet-200',  border: 'border-violet-500',  text: 'text-violet-900',  chip: 'bg-violet-400 text-violet-950' },
  vip:      { bg: 'bg-pink-200',    border: 'border-pink-500',    text: 'text-pink-900',    chip: 'bg-pink-400 text-pink-950' },
  elite:    { bg: 'bg-emerald-200', border: 'border-emerald-500', text: 'text-emerald-900', chip: 'bg-emerald-400 text-emerald-950' },
}

export const PACKAGE_TONE_FALLBACK: PackageTone = {
  bg: 'bg-blue-200', border: 'border-blue-400', text: 'text-blue-900', chip: 'bg-blue-400 text-blue-950',
}

// Expired plans are greyed out regardless of package.
export const EXPIRED_TONE: PackageTone = {
  bg: 'bg-gray-100', border: 'border-gray-200', text: 'text-gray-400', chip: 'bg-gray-200 text-gray-400',
}

export function packageTone(name?: string | null): PackageTone {
  if (!name) return PACKAGE_TONE_FALLBACK
  return PACKAGE_TONE[name.trim().toLowerCase()] ?? PACKAGE_TONE_FALLBACK
}
