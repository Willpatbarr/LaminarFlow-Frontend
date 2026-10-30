import { useParams } from '@solidjs/router'

import { HierarchyDetail } from '@/features/hierarchy/HierarchyDetail'
import { HierarchyList } from '@/features/hierarchy/HierarchyList'

import { epicById, milestoneById, sprintById } from '@/sync'

import { viewer } from './viewer'
import { usePageTitle } from './pageTitle'

// /epics, /sprints, /milestones and the page of one of each. The id goes down
// as a prop that follows the URL, so moving from one to another re-uses the page.
export const EpicsPage = () => {
    usePageTitle(() => 'Epics')
    return <HierarchyList kind="epic" />
}
export const SprintsPage = () => {
    usePageTitle(() => 'Sprints')
    return <HierarchyList kind="sprint" />
}
export const MilestonesPage = () => {
    usePageTitle(() => 'Milestones')
    return <HierarchyList kind="milestone" />
}

function useItemTitle(kind: 'epic' | 'sprint' | 'milestone', id: () => string) {
    usePageTitle(() => {
        const found = kind === 'epic' ? epicById(id()) : kind === 'sprint' ? sprintById(id()) : milestoneById(id())
        return found ? found.name.trim() || `Untitled ${kind}` : undefined
    })
}

export function EpicPage() {
    const params = useParams<{ id: string }>()
    useItemTitle('epic', () => params.id)
    return <HierarchyDetail kind="epic" id={params.id} viewer={viewer()} />
}
export function SprintPage() {
    const params = useParams<{ id: string }>()
    useItemTitle('sprint', () => params.id)
    return <HierarchyDetail kind="sprint" id={params.id} viewer={viewer()} />
}
export function MilestonePage() {
    const params = useParams<{ id: string }>()
    useItemTitle('milestone', () => params.id)
    return <HierarchyDetail kind="milestone" id={params.id} viewer={viewer()} />
}
