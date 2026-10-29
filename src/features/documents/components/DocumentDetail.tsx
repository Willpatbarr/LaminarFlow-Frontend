import { useNavigate } from '@solidjs/router'
import { createEffect, createMemo, createSignal, Match, Show, Switch, untrack } from 'solid-js'

import { MarkdownEditor } from '@/components/editor/MarkdownEditor'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SkeletonBox } from '@/components/ui/Skeleton'
import {
    discard,
    documentById,
    documentHead,
    documentSyncState,
    isLoading,
    keepAsNew,
    resolveId,
    retry,
    updateDocument,
    type Doc,
} from '@/sync'
import type { EntryError } from '@/sync'

import { createAutosave } from '../autosave'
import { CONTENT_KEY, TITLE_MAX } from '../content'
import { DocumentConflictPanel } from './DocumentConflictPanel'
import './documents.css'

type DocumentDetailProps = {
    /** From the URL. May be a temporary id, or one that has since been replaced. */
    id: string
    /** Force the placeholder, whatever the store says. */
    loading?: boolean
}

// The document page at /documents/:id, modelled on the ticket page: the id
// follows the URL, a document made offline is opened under a temporary id and
// the page keeps working (and the address is replaced) when the server answers.
export function DocumentDetail(props: DocumentDetailProps) {
    const navigate = useNavigate()
    const doc = createMemo(() => documentById(props.id))
    const busy = () => props.loading || isLoading()

    const [notice, setNotice] = createSignal('')

    createEffect(
        () => resolveId(props.id),
        (resolved) => {
            if (resolved !== untrack(() => props.id)) navigate(`/documents/${resolved}`, { replace: true })
        },
    )

    return (
        <section class="document" aria-busy={busy() ? 'true' : undefined}>
            <p class="t-meta">
                <a href="/documents">← Documents</a>
            </p>
            <div class="document__notice t-body" aria-live="polite" aria-atomic="true">
                {notice()}
            </div>
            <Switch
                fallback={
                    <>
                        <h1 class="t-screen-title">Document not found</h1>
                        <p class="t-body">It may have been archived, or the address may be wrong.</p>
                    </>
                }
            >
                <Match when={busy()}>
                    <p class="visually-hidden" role="status">
                        Loading document…
                    </p>
                    <div aria-hidden="true" class="document">
                        <SkeletonBox shape="control" height="40px" />
                        <SkeletonBox shape="control" height="260px" />
                    </div>
                </Match>
                <Match when={doc()}>
                    {(found) => <DocumentEditor doc={found()} announce={setNotice} />}
                </Match>
            </Switch>
        </section>
    )
}

type DocumentEditorProps = {
    doc: Doc
    announce: (text: string) => void
}

function refusal(error: EntryError): string {
    const detail = error.errors.map((e) => e.message).filter(Boolean)
    return detail.length > 0
        ? `The server didn't accept this change: ${detail.join('; ')}.`
        : "The server didn't accept this change."
}

// HOW IT SAVES: there is no Save button. Typing is saved to the local store a
// moment after it stops (and the moment focus leaves the field, and when the
// page is left), and the store sends it through the outbox. The line above the
// title says where it has got to.
function DocumentEditor(props: DocumentEditorProps) {
    const navigate = useNavigate()
    const id = () => props.doc.id

    const title = createAutosave(
        () => props.doc.title,
        (value) => updateDocument(id(), { title: value.trim() }),
    )
    const content = createAutosave(
        () => props.doc.body[CONTENT_KEY] ?? '',
        // The body is replaced whole, so everything else in it goes back too.
        (value) => updateDocument(id(), { body: { ...documentById(id())?.body, [CONTENT_KEY]: value } }),
    )

    const titleError = () =>
        [...title.value().trim()].length > TITLE_MAX
            ? `Title can be at most ${TITLE_MAX} characters.`
            : undefined

    const head = createMemo(() => documentHead(id()))
    const conflicted = createMemo(() => {
        const found = head()
        return found?.state === 'conflict' && found.conflict ? { entryId: found.id, conflict: found.conflict } : null
    })
    const refused = createMemo(() => {
        const found = head()
        return found?.state === 'failed' && found.error ? { entryId: found.id, message: refusal(found.error) } : null
    })
    const locked = () => conflicted() !== null

    const status = () => {
        if (title.dirty() || content.dirty()) return 'Saving…'
        switch (documentSyncState(id())) {
            case 'synced':
                return 'Saved'
            case 'pending':
                return head() && head()!.attempts > 0
                    ? 'Saved on this device. Not synced yet: will retry'
                    : 'Saving…'
            case 'unauthorized':
                return 'Saved on this device. Not synced: sign in again'
            case 'failed':
                return 'Not synced: the server refused this change'
            case 'conflict':
                return 'Needs a decision: someone else changed this document'
        }
    }

    async function keepTheirs() {
        const found = conflicted()
        if (!found) return
        title.reset()
        content.reset()
        await discard(found.entryId)
        props.announce(
            found.conflict.archived
                ? "Discarded your change. The document was archived, so it's no longer in your list."
                : 'Kept their version. Your change was discarded.',
        )
    }

    async function useMine() {
        const found = conflicted()
        if (!found) return
        props.announce('Sending your version.')
        await retry(found.entryId)
        if (documentHead(id())?.state === 'conflict') {
            props.announce("That didn't go through: the document changed again. Your version still hasn't been saved.")
        } else {
            props.announce('Saved. Your version replaced theirs.')
        }
    }

    async function keepMineAsNew() {
        const found = conflicted()
        if (!found) return
        title.reset()
        content.reset()
        const copy = await keepAsNew(found.entryId)
        if (!copy) return
        navigate(`/documents/${copy}`)
        props.announce(
            found.conflict.archived
                ? 'Saved your version as a new document. The original stays archived.'
                : 'Saved your version as a new document. The original is back to their version.',
        )
    }

    return (
        <div class="document">
            <div class="document__status t-meta" role="status">
                {status()}
            </div>

            <Show when={refused()}>
                {(failure) => (
                    <div class="document__failure" role="alert">
                        <p class="t-body">{failure().message}</p>
                        <div>
                            <Button variant="secondary" onClick={() => void discard(failure().entryId)}>
                                Discard my change
                            </Button>
                        </div>
                    </div>
                )}
            </Show>

            <Show when={conflicted()}>
                {(found) => (
                    <DocumentConflictPanel
                        conflict={found().conflict}
                        mine={props.doc}
                        onKeepTheirs={keepTheirs}
                        onUseMine={useMine}
                        onKeepAsNew={keepMineAsNew}
                    />
                )}
            </Show>

            <Input
                label="Title"
                readOnly={locked()}
                placeholder="Untitled"
                value={title.value()}
                onInput={(value) => {
                    if (!locked()) title.input(value)
                }}
                onBlur={() => {
                    if (!titleError()) void title.flush()
                }}
                error={titleError()}
            />

            <MarkdownEditor
                label="Text"
                placeholder="Write, or type Markdown: # for a heading, - for a list…"
                value={content.value()}
                readOnly={locked()}
                onChange={(value) => {
                    if (!locked()) content.input(value)
                }}
                onBlur={() => void content.flush()}
            />
        </div>
    )
}
