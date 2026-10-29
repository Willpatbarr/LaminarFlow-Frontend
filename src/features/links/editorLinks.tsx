import { createEffect, createRoot, onSettled } from 'solid-js'
import { useNavigate } from '@solidjs/router'

import { LINK_KINDS, setEditorLinks, titlesChanged, type LinkKind, type LinkPickerProps, type LinkRef, type LinkTarget } from '@/components/editor/internalLinks'
import { documentById, isTempId, sync, ticketById } from '@/sync'

import { LinkPicker, type PickOption } from './LinkPicker'

/*
┌─ links ─────────────────────────────────────────
│  the app's side of internal links in the editor (LAM-108): titles, going to a
│  target, and the picker, all from the local store
├─ out ───────────────────────────────────────────
│      useEditorLinks()   registers them with the editor while the shell is mounted
│      titleOf(ref)       the target's current title, if the store has it
│      candidates()       everything that can be linked
*/
// Offline-first: nothing here asks the server. A target that has not synced
// has no title yet, and the chip falls back to the label written in the text.

const PROJECT_HINT: Record<LinkKind, string> = { ticket: 'Ticket', document: 'Document', project: 'Project' }

export function titleOf(ref: LinkRef): string | undefined {
    switch (ref.kind) {
        case 'ticket':
            return ticketById(ref.id)?.title
        case 'document':
            return documentById(ref.id)?.title
        case 'project':
            return sync.projects.find((project) => project.id === ref.id)?.name
    }
}

/** Everything that can be linked. Not yet-unsent items: their temporary id
 *  would be written into the text and stop working once the server renames it. */
export function candidates(): LinkTarget[] {
    const all: LinkTarget[] = [
        ...sync.tickets.map((t) => ({ kind: 'ticket' as const, id: t.id, title: t.title })),
        ...sync.documents.map((d) => ({ kind: 'document' as const, id: d.id, title: d.title })),
        ...sync.projects.map((p) => ({ kind: 'project' as const, id: p.id, title: p.name })),
    ]
    return all.filter((target) => !isTempId(target.id))
}

function InternalLinkPicker(props: LinkPickerProps) {
    const options = (): PickOption[] =>
        candidates().map((target) => ({
            id: `${target.kind}/${target.id}`,
            label: target.title || '(untitled)',
            hint: PROJECT_HINT[target.kind],
        }))
    return (
        <LinkPicker
            title="Link to a ticket, document or project"
            noun="item"
            searchLabel="Search tickets, documents and projects"
            options={options()}
            onPick={(key) => {
                const [kind, ...rest] = key.split('/')
                const id = rest.join('/')
                const target = candidates().find((t) => t.kind === kind && t.id === id)
                if (target && LINK_KINDS.includes(target.kind)) props.onPick(target)
            }}
            onClose={props.onClose}
        />
    )
}

// Tells the chips on screen when a title they may show has changed. One
// watcher for the app, not one per chip. Its compute is a key over every title.
createRoot(() => {
    createEffect(
        () =>
            [sync.tickets.map((t) => t.title), sync.documents.map((d) => d.title), sync.projects.map((p) => p.name)]
                .map((titles) => titles.join('\u0000'))
                .join('\u0001'),
        () => titlesChanged(),
    )
})

export function useEditorLinks() {
    const navigate = useNavigate()
    onSettled(() => {
        setEditorLinks({ titleOf, open: (route) => navigate(route), picker: (props) => <InternalLinkPicker {...props} /> })
        return () => setEditorLinks(null)
    })
}
