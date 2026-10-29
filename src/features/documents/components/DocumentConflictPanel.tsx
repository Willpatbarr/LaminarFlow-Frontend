import { createSignal, createUniqueId, For, Show } from 'solid-js'

import type { AspectField } from '@/features/aspects/api'
import { Button } from '@/components/ui/Button'
import { RelativeTime } from '@/features/tickets/components/RelativeTime'
import { sync, type Doc, type DocConflict } from '@/sync'

import { CONTENT_KEY } from '../content'
import '@/features/tickets/components/conflict.css'

type DocumentConflictPanelProps = {
    /** What the 409 said: the server's copy and when it changed. */
    conflict: DocConflict
    /** The user's version: the document as it stands here, their edits included. */
    mine: Doc
    /** The fields to compare when the document is an aspect (its type's, in order). */
    fields?: AspectField[]
    onKeepTheirs: () => Promise<unknown>
    onUseMine: () => Promise<unknown>
    onKeepAsNew: () => Promise<unknown>
    /** Only these are compared: the ones both sides changed (`title`, and
     *  `body.<key>` for each body key). Absent, every field that differs. */
    only?: string[]
}

type Difference = { field: string; mine: string; theirs: string }

// The ConflictPanel's pattern, for a document (LAM-71): information with three
// honest ways forward, nothing lost, no merge. The text is compared as the
// Markdown it is stored as. A document's 409 names nobody, so it says only
// when it changed.
export function DocumentConflictPanel(props: DocumentConflictPanelProps) {
    const headingId = createUniqueId()
    const [busy, setBusy] = createSignal(false)

    const theirs = () => props.conflict.current
    const archived = () => props.conflict.archived

    const shown = (field: string) => !props.only || props.only.includes(field)

    const differences = (): Difference[] => {
        if (archived()) return []
        const found: Difference[] = []
        if (shown('title') && props.mine.title !== theirs().title) {
            found.push({ field: 'Title', mine: props.mine.title, theirs: theirs().title })
        }
        if (shown('project_id') && props.mine.project_id !== theirs().project_id) {
            const name = (id: string | null) =>
                id === null ? 'No project (team-wide)' : (sync.projects.find((project) => project.id === id)?.name ?? 'A project')
            found.push({ field: 'Project', mine: name(props.mine.project_id), theirs: name(theirs().project_id) })
        }
        // An aspect's text is spread over its fields; a normal document's is one.
        const keys = props.fields
            ? props.fields.map((f) => ({ key: f.id, name: f.label }))
            : [{ key: CONTENT_KEY, name: 'Text' }]
        for (const { key, name } of keys) {
            const mine = props.mine.body[key] ?? ''
            const other = theirs().body[key] ?? ''
            if (shown(`body.${key}`) && mine !== other) found.push({ field: name, mine, theirs: other })
        }
        return found
    }

    async function run(action: () => Promise<unknown>) {
        setBusy(true)
        try {
            await action()
        } finally {
            setBusy(false)
        }
    }

    return (
        <section class="conflict" role="region" aria-labelledby={headingId}>
            <h2 id={headingId} class="conflict__title t-section">
                This document needs a decision
            </h2>
            <p class="t-body">
                This document was {archived() ? 'archived' : 'edited'} somewhere else{' '}
                <RelativeTime at={props.conflict.changed_at} />.
            </p>
            <p class="t-body">Your change hasn't been saved to the server. It's still here.</p>

            <Show when={differences().length > 0}>
                <div class="conflict__fields" role="group" aria-label="What differs">
                    <For each={differences()}>
                        {(difference) => (
                            <div class="conflict__field">
                                <h3 class="conflict__field-name t-overline">{difference.field}</h3>
                                <div class="conflict__pair">
                                    <Side label="Your version" value={difference.mine} />
                                    <Side label="Their version" value={difference.theirs} />
                                </div>
                            </div>
                        )}
                    </For>
                </div>
            </Show>
            <Show when={!archived() && differences().length === 0}>
                <p class="t-meta">Your version and theirs read the same.</p>
            </Show>

            <p class="t-meta">
                Editing is paused until you decide, so nothing more is added to a version that may be
                set aside.
            </p>

            <div class="conflict__actions">
                <Button variant="secondary" disabled={busy()} onClick={() => void run(props.onKeepTheirs)}>
                    {archived() ? 'Discard my change' : 'Keep theirs'}
                </Button>
                <Show when={!archived()}>
                    <Button variant="secondary" disabled={busy()} onClick={() => void run(props.onUseMine)}>
                        Use mine
                    </Button>
                </Show>
                <Button variant="primary" disabled={busy()} onClick={() => void run(props.onKeepAsNew)}>
                    Keep mine as a new document
                </Button>
            </div>
        </section>
    )
}

function Side(props: { label: string; value: string }) {
    return (
        <div class="conflict__side">
            <span class="conflict__side-label t-meta">{props.label}</span>
            <Show
                when={props.value !== ''}
                fallback={<p class="conflict__value conflict__value--empty t-body">Empty</p>}
            >
                <p class="conflict__value t-body" style={{ 'white-space': 'pre-wrap' }}>
                    {props.value}
                </p>
            </Show>
        </div>
    )
}
