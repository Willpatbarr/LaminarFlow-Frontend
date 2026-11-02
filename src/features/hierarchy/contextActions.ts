import type { IconName } from '@/components/ui/icons/Icon'

/*
┌─ hierarchy ─────────────────────────────────────
│  the sidebar's "New team" and "New project in <team>" actions (LAM-199)
├─ in ────────────────────────────────────────────
│      can        permission → whether the viewer holds it
│      team       the team in view; absent: no project can be made
│      offline    the change feed says the browser is offline
├─ out ───────────────────────────────────────────
│      contextActions    the create actions the viewer may use, in order
│      nameProblem       why a team or project name cannot be sent, or undefined
*/
// Both calls are direct API calls (the store's createTeam / createProject), not
// queued writes, so they cannot work offline. The action stays in the list,
// disabled with the reason, rather than disappearing: collapse is fine, hide is
// not. It is left out only when the viewer lacks the permission, because then
// there is nothing they could do about it.

export type ContextAction = {
    kind: 'team' | 'project'
    label: string
    icon: IconName
    /** Set when the action cannot be used right now, and why. */
    disabledReason?: string
}

export const OFFLINE_REASON = 'Needs a connection: teams and projects are created on the server.'

export function contextActions(options: {
    can: (permission: string) => boolean
    team?: { name: string }
    offline: boolean
}): ContextAction[] {
    const disabledReason = options.offline ? OFFLINE_REASON : undefined
    const actions: ContextAction[] = []
    if (options.can('team:write')) actions.push({ kind: 'team', label: 'New team', icon: 'team', disabledReason })
    if (options.can('project:write') && options.team) {
        actions.push({ kind: 'project', label: `New project in ${options.team.name}`, icon: 'project', disabledReason })
    }
    return actions
}

/** The name is required, and is not only whitespace. The length limit is `overMessage`'s. */
export function nameProblem(noun: 'Team' | 'Project', name: string): string | undefined {
    return name.trim() === '' ? `${noun} name is required.` : undefined
}
