/*
┌─ tokens ────────────────────────────────────────
│  scopes: what each token scope allows, in plain English
├─ out ───────────────────────────────────────────
│      SCOPE_DESCRIPTIONS   one line per scope code - the single place to add one
│      SCOPE_GROUPS         the areas, each with a read and a write scope
│      DANGEROUS_SCOPES     scopes that need an extra confirmation
│      describeScope        scope code → its one-line description
│      layoutScopes         the scopes the server offers → groups, dangerous, others
├─ note ──────────────────────────────────────────
│      The server decides which scopes exist (GET /auth/me permissions); this file
│      only says what they mean. A scope the server offers with no entry here is
│      still shown, under "Other", and the unit test fails until it is described.
│      The API does not make write imply read (token scopes are matched one by one),
│      so picking Write never picks Read.
*/
export const SCOPE_DESCRIPTIONS: Record<string, string> = {
    'ticket:read':
        'View tickets, boards, epics, sprints, milestones, labels, saved views, documents, comments and search.',
    'ticket:write': 'Create, edit and archive the same things.',
    'aspect:read': 'View aspect types and their fields.',
    'aspect:write': 'Create and edit aspect types and fields, including import.',
    'setting:read': 'View settings.',
    'setting:write': 'Create, change and delete settings.',
    'team:read': 'View teams and their statuses.',
    'team:write': 'Create and rename teams; add, edit, reorder and delete statuses.',
    'project:read': 'View projects.',
    'project:write': 'Create and rename projects.',
    'account:delete': 'Delete your account.',
}

export type ScopeGroup = { id: string; title: string; read: string; write: string }

export const SCOPE_GROUPS: ScopeGroup[] = [
    { id: 'tickets', title: 'Tickets and content', read: 'ticket:read', write: 'ticket:write' },
    { id: 'projects', title: 'Projects', read: 'project:read', write: 'project:write' },
    { id: 'teams', title: 'Teams and statuses', read: 'team:read', write: 'team:write' },
    { id: 'aspects', title: 'Aspect types', read: 'aspect:read', write: 'aspect:write' },
    { id: 'settings', title: 'Settings', read: 'setting:read', write: 'setting:write' },
]

export const DANGEROUS_SCOPES = ['account:delete']

/** What a holder of the dangerous scope could do, in neutral words. */
export const DANGEROUS_WARNING =
    'Anyone who has a token with this permission can delete your account, without signing in. ' +
    'Deleting an account cannot be undone.'

export function describeScope(scope: string): string | undefined {
    return SCOPE_DESCRIPTIONS[scope]
}

export type ScopeLayout = {
    groups: { group: ScopeGroup; read?: string; write?: string }[]
    dangerous: string[]
    other: string[]
}

/** Lay out the scopes the server offers; each appears exactly once. */
export function layoutScopes(offered: string[]): ScopeLayout {
    const has = new Set(offered)
    const placed = new Set<string>()
    const groups: ScopeLayout['groups'] = []
    for (const group of SCOPE_GROUPS) {
        const read = has.has(group.read) ? group.read : undefined
        const write = has.has(group.write) ? group.write : undefined
        if (!read && !write) continue
        if (read) placed.add(read)
        if (write) placed.add(write)
        groups.push({ group, read, write })
    }
    const dangerous = offered.filter((s) => DANGEROUS_SCOPES.includes(s))
    dangerous.forEach((s) => placed.add(s))
    const other = offered.filter((s) => !placed.has(s))
    return { groups, dangerous, other }
}
