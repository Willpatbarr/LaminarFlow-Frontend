import { onSettled } from 'solid-js'

import { Avatar } from '@/components/ui/Avatar'
import { monogram } from '@/components/ui/SideNav'
import { ensureMembers, memberName } from '@/features/members/members'

import type { Viewer } from '../viewer'

type AssigneeMarkerProps = {
    assigneeId: string | null
    viewer: Viewer
}

// The viewer is named from the session; anyone else from the workspace members
// list (LAM-128). Until that list answers, or if the person has left it, they
// are "someone else", drawn with no initials to get wrong.
export function AssigneeMarker(props: AssigneeMarkerProps) {
    onSettled(() => void ensureMembers())
    const mine = () => props.assigneeId === props.viewer.accountId
    const name = () => (props.assigneeId === null ? undefined : mine() ? props.viewer.displayName : memberName(props.assigneeId))
    return (
        <Avatar
            initials={props.assigneeId === null ? undefined : monogram(name() ?? '') || '··'}
            label={
                props.assigneeId === null
                    ? 'Unassigned'
                    : mine()
                      ? 'Assigned to you'
                      : name()
                        ? `Assigned to ${name()}`
                        : 'Assigned to someone else'
            }
        />
    )
}
