import { useNavigate } from '@solidjs/router'
import { createEffect, createMemo, createSignal, For, Match, Show, Switch, untrack } from 'solid-js'

import { MarkdownEditor } from '@/components/editor/MarkdownEditor'
import { Button } from '@/components/ui/Button'
import { Banner } from '@/components/ui/Banner'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { SkeletonBox } from '@/components/ui/Skeleton'
import { getAspectType, listAspectTypes, type AspectField, type AspectType } from '@/features/aspects/api'
import { bodyForConversion, createAspectTypeFeed, orderedFields } from '@/features/aspects/fields'
import {
    discard,
    documentById,
    documentHead,
    documentSyncState,
    isLoading,
    keepAsNew,
    resolveId,
    retry,
    sync,
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

    const isAspect = () => props.doc.type === 'aspect'
    // The type is not a synced entity, so it is asked for: on opening, when the
    // document changes (a sync landed), when the tab is shown again, and on a timer.
    const feed = createAspectTypeFeed(
        () => (isAspect() ? props.doc.aspect_type_id : null),
        () => props.doc.version,
    )
    const fields = () => orderedFields(feed.type())

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

    // Typed in any aspect field and not yet saved.
    const [fieldDrafts, setFieldDrafts] = createSignal(0)
    const status = () => {
        if (title.dirty() || content.dirty() || fieldDrafts() > 0) return 'Saving…'
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
                        fields={isAspect() ? fields() : undefined}
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
            <Show when={isAspect()}>
                <p class="t-meta">
                    Aspect: {feed.type()?.name ?? 'loading its fields…'}
                </p>
                <Show when={feed.missing()}>
                    <Banner hue="rust">This document's aspect type no longer exists.</Banner>
                </Show>
                <Show when={feed.problem()}>
                    {(message) => <Banner hue="rust">{message()}</Banner>}
                </Show>
                <For each={fields()} keyed={(field) => field.id}>
                    {(field) => (
                        <AspectFieldEditor
                            docId={id()}
                            field={field()}
                            saved={() => props.doc.body[field().id] ?? ''}
                            locked={locked()}
                            onDirty={(dirty) => setFieldDrafts((n) => n + (dirty ? 1 : -1))}
                        />
                    )}
                </For>
            </Show>

            <Show when={!isAspect()}>
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
                <MakeAspect
                    doc={props.doc}
                    disabled={locked()}
                    text={content.value}
                    onMade={async () => {
                        content.reset()
                        props.announce('Made this an Aspect.')
                    }}
                />
            </Show>
        </div>
    )
}

type AspectFieldEditorProps = {
    docId: string
    field: AspectField
    saved: () => string
    locked: boolean
    onDirty: (dirty: boolean) => void
}

// One field of an aspect: its label above an editor of its own. Saved like the
// text of a normal document, under the field's id. The rest of the body goes
// back with it, so the values of fields the type has since dropped stay stored.
function AspectFieldEditor(props: AspectFieldEditorProps) {
    const value = createAutosave(props.saved, (markdown) =>
        updateDocument(props.docId, { body: { ...documentById(props.docId)?.body, [props.field.id]: markdown } }),
    )
    let wasDirty = false
    createEffect(
        () => value.dirty(),
        (dirty) => {
            if (dirty !== wasDirty) {
                wasDirty = dirty
                props.onDirty(dirty)
            }
        },
    )
    return (
        <MarkdownEditor
            label={props.field.label}
            placeholder="Write, or type Markdown…"
            value={value.value()}
            readOnly={props.locked}
            onChange={(markdown) => {
                if (!props.locked) value.input(markdown)
            }}
            onBlur={() => void value.flush()}
        />
    )
}

type MakeAspectProps = {
    doc: Doc
    disabled: boolean
    /** What the editor holds now, including words not yet saved. */
    text: () => string
    onMade: () => Promise<void>
}

// "Make this an Aspect": pick a type, and the document becomes one through the
// outbox like any other edit. The server moves the text into the type's first
// field, and so does the local copy (bodyForConversion), so they agree. Types
// are asked for, not synced, so this needs a connection to list them.
function MakeAspect(props: MakeAspectProps) {
    const [types, setTypes] = createSignal<AspectType[]>([])
    const teamName = (id: string) => sync.teams.find((team) => team.id === id)?.name ?? 'Team'
    const [chosen, setChosen] = createSignal('')
    const [error, setError] = createSignal<string | undefined>()
    const [unavailable, setUnavailable] = createSignal(false)
    const [busy, setBusy] = createSignal(false)

    // The document's own team, else its project's, else every team's.
    const teamIds = () => {
        const own = props.doc.team_id ?? sync.projects.find((p) => p.id === props.doc.project_id)?.team_id
        return own ? [own] : sync.teams.map((team) => team.id)
    }

    createEffect(
        () => teamIds().join(','),
        (ids) => {
            void (async () => {
                const found: AspectType[] = []
                let failed = false
                for (const teamId of ids.split(',').filter(Boolean)) {
                    const result = await listAspectTypes(teamId)
                    if (result.ok) found.push(...(result.data.items ?? []))
                    else failed = true
                }
                setTypes(found.toSorted((a, b) => a.name.localeCompare(b.name)))
                setUnavailable(failed)
            })()
        },
    )

    async function make() {
        const typeId = chosen()
        if (!typeId) {
            setError('Choose an aspect type.')
            return
        }
        setBusy(true)
        setError(undefined)
        try {
            // The type as it is now: its first field is where the text goes.
            const fetched = await getAspectType(typeId)
            if (!fetched.ok) {
                setError(fetched.message)
                return
            }
            const body = bodyForConversion(props.text(), fetched.data)
            if (!body) {
                setError('This aspect type has no fields yet. Add a field to it first, then try again.')
                return
            }
            await updateDocument(props.doc.id, { type: 'aspect', aspect_type_id: typeId, body })
            await props.onMade()
        } finally {
            setBusy(false)
        }
    }

    return (
        <Show when={types().length > 0 || unavailable()}>
            <div class="document__aspect">
                <Select
                    label="Aspect type"
                    value={chosen()}
                    onChange={(value) => {
                        setChosen(value)
                        setError(undefined)
                    }}
                    options={[
                        { value: '', label: 'Choose a type…' },
                        ...types().map((item) => ({
                            value: item.id,
                            // Several teams' types at once: say whose each one is.
                            label: teamIds().length > 1 ? `${teamName(item.team_id)} · ${item.name}` : item.name,
                        })),
                    ]}
                    error={error() ?? (unavailable() ? 'Could not load every aspect type. Check the connection.' : undefined)}
                />
                <Button variant="secondary" disabled={props.disabled || busy()} onClick={() => void make()}>
                    Make this an Aspect
                </Button>
            </div>
        </Show>
    )
}
