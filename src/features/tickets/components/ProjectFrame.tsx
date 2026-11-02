import type { JSX } from '@solidjs/web'

import { Show } from 'solid-js'

import { PageLayout, PageSubnav, type PageSize } from '@/components/ui/PageLayout'

import { ProjectNameHeading } from './NameEditor'
import './ProjectFrame.css'

/*
┌─ tickets ───────────────────────────────────────
│  ProjectFrame: the header a project's pages share (LAM-201)
├─ out ───────────────────────────────────────────
│      ProjectFrame   <ProjectFrame projectId name tab="tickets" size="wide">…</ProjectFrame>
├─ example ───────────────────────────────────────
│      the project's list and its board: the same title, the same Tickets | Documents
│      tabs, and the List | Board switch in the same place, so switching views moves nothing
*/
// The project's list and its board used to have two headers: the list's title
// with the switch among its buttons, the board's with a back link, a different
// title ("Project · Board") and the switch under it. Now both are this: the
// project's name, the tabs, and (from the list or the board, which know the
// filter it carries) the switch in the row under the title.
type ProjectFrameProps = {
    projectId: string
    /** Absent while the project is still loading: the tabs and the body show, the title waits. */
    name?: string
    tab: 'tickets' | 'documents'
    size?: PageSize
    children: JSX.Element
}

export function ProjectFrame(props: ProjectFrameProps) {
    return (
        <PageLayout
            size={props.size}
            title={
                <Show when={props.name}>
                    {(name) => <ProjectNameHeading projectId={props.projectId} name={name()} />}
                </Show>
            }
        >
            <PageSubnav>
                <nav class="project-tabs" aria-label="Project">
                    <a
                        href={`/projects/${props.projectId}`}
                        aria-current={props.tab === 'documents' ? undefined : 'page'}
                    >
                        Tickets
                    </a>
                    <a
                        href={`/projects/${props.projectId}/documents`}
                        aria-current={props.tab === 'documents' ? 'page' : undefined}
                    >
                        Documents
                    </a>
                </nav>
            </PageSubnav>
            {props.children}
        </PageLayout>
    )
}
