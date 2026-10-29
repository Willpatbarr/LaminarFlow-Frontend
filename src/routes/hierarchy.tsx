import { useParams } from '@solidjs/router'

import { HierarchyDetail } from '@/features/hierarchy/HierarchyDetail'
import { HierarchyList } from '@/features/hierarchy/HierarchyList'

import { viewer } from './viewer'

// /epics, /sprints, /milestones and the page of one of each. The id goes down
// as a prop that follows the URL, so moving from one to another re-uses the page.
export const EpicsPage = () => <HierarchyList kind="epic" />
export const SprintsPage = () => <HierarchyList kind="sprint" />
export const MilestonesPage = () => <HierarchyList kind="milestone" />

export function EpicPage() {
    const params = useParams<{ id: string }>()
    return <HierarchyDetail kind="epic" id={params.id} viewer={viewer()} />
}
export function SprintPage() {
    const params = useParams<{ id: string }>()
    return <HierarchyDetail kind="sprint" id={params.id} viewer={viewer()} />
}
export function MilestonePage() {
    const params = useParams<{ id: string }>()
    return <HierarchyDetail kind="milestone" id={params.id} viewer={viewer()} />
}
