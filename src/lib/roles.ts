// ============================================================================
// src/lib/roles.ts — who may work which desk
// ============================================================================
// A *role* is a job title. A *duty* is a desk on the order pipeline. They used
// to be the same thing — one role per desk — and they stopped being the same in
// September 2026, when the Manager and Designer desks were folded into Back
// Office. Roshini runs all three now, and there is no manager login left at all.
//
// So: ask `hasDuty(role, 'manager')` instead of `role === 'manager'`, and build
// every "who can I hand this step to?" picker from `canTakeDuty(...)` rather
// than a single role string. A picker filtered on one role goes empty the
// moment the last holder of that role is deactivated — which is exactly what
// would have happened to the Manager picker when Hiruni was removed.
// ============================================================================

export type Duty = 'crm' | 'back_office' | 'counselor' | 'manager' | 'designer'

const ROLE_DUTIES: Record<string, Duty[]> = {
    crm_agent: ['crm'],
    team_leader: ['crm'],
    counselor: ['counselor'],
    // Back office carries its own desk plus the two it absorbed.
    back_office: ['back_office', 'manager', 'designer'],
    manager: ['manager'],
    designer: ['designer'],
}

/**
 * May the signed-in user act at this desk? Admin and CEO can stand in anywhere.
 */
export function hasDuty(role: string | null | undefined, duty: Duty): boolean {
    if (!role) return false
    if (role === 'admin' || role === 'ceo') return true
    return (ROLE_DUTIES[role] ?? []).includes(duty)
}

/**
 * The same question asked about a co-worker you are about to hand a step to.
 * Admin and CEO are deliberately excluded: they can act at any desk, but live
 * work should never be parked on those accounts.
 */
export function canTakeDuty(role: string | null | undefined, duty: Duty): boolean {
    if (!role) return false
    return (ROLE_DUTIES[role] ?? []).includes(duty)
}

/** Roles worth loading from `users` when filling a picker for `duty`. */
export function rolesForDuty(duty: Duty): string[] {
    return Object.keys(ROLE_DUTIES).filter(r => ROLE_DUTIES[r].includes(duty))
}
