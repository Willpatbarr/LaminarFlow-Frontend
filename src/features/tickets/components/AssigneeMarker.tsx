import { Avatar } from '@/components/ui/Avatar'
import { monogram } from '@/components/ui/SideNav'

import type { Viewer } from '../viewer'

type AssigneeMarkerProps = {
    assigneeId: string | null
    viewer: Viewer
}

// There is no endpoint that lists accounts, so the only assignee this client
// can name is the viewer. Anyone else is "someone else", drawn as an avatar
// with no initials to get wrong.
export function AssigneeMarker(props: AssigneeMarkerProps) {
    const mine = () => props.assigneeId === props.viewer.accountId
    return (
        <Avatar
            initials={
                props.assigneeId === null
                    ? undefined
                    : mine()
                      ? monogram(props.viewer.displayName) || '?'
                      : '··'
            }
            label={
                props.assigneeId === null
                    ? 'Unassigned'
                    : mine()
                      ? 'Assigned to you'
                      : 'Assigned to someone else'
            }
        />
    )
}
