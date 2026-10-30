import { createMemo, createSignal, For, Show } from 'solid-js'

import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/icons/Icon'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { CONTENT_KEY, TITLE_MAX } from '@/features/documents/content'
import { createDocument, documentById, sync } from '@/sync'

import { getTicketDocuments, linkDocument, unlinkDocument, type LinkedDocument } from './api'
import { createLinkFeed } from './feed'
import { LinkPicker, type PickOption } from './LinkPicker'
import { settledId } from './settled'
import './links.css'

/*
┌─ links ─────────────────────────────────────────
│  LinkedDocuments: the "Documents" section of the ticket page (LAM-120)
├─ out ───────────────────────────────────────────
│      LinkedDocuments   <LinkedDocuments ticketId projectId disabled />
*/
// Links the ticket to documents the local store already holds (a searchable
// picker), or makes a new document - through the sync engine, so it works
// offline - and links it. Unlinking asks nothing: it is undone by linking
// again, and nothing is deleted. The list is the server's (`GET /tickets/{id}`).

type LinkedDocumentsProps = {
    /** From the URL; may be a temporary id. */
    ticketId: string
    /** The ticket's project: a document made here is filed under it. */
    projectId: string
    /** The ticket is read-only for now (a collision to decide). */
    disabled?: boolean
}

export const titleOf = (title: string) => title.trim() || 'Untitled'

export function LinkedDocuments(props: LinkedDocumentsProps) {
    const feed = createLinkFeed<LinkedDocument>({
        owner: () => props.ticketId,
        load: getTicketDocuments,
        concerns: (event, ownerId) => (event.ticketId === ownerId ? event.documentId : null),
    })
    const [picking, setPicking] = createSignal(false)
    const [making, setMaking] = createSignal(false)
    const [announcement, setAnnouncement] = createSignal('')

    const candidates = createMemo<PickOption[]>(() => {
        const linked = new Set(feed.items().map((item) => item.id))
        return sync.documents
            .filter((doc) => !linked.has(doc.id))
            .map((doc) => ({ id: doc.id, label: titleOf(doc.title), hint: doc.type === 'aspect' ? 'Aspect' : undefined }))
            .toSorted((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    })

    async function link(documentId: string, shown: LinkedDocument) {
        const ok = await feed.add(shown, async () => {
            const [ticket, document] = await Promise.all([settledId(props.ticketId), settledId(documentId)])
            if (!ticket.ok) return ticket
            if (!document.ok) return document
            const sent = await linkDocument(ticket.data, document.data)
            return sent.ok ? { ok: true as const, data: document.data } : sent
        })
        if (ok) setAnnouncement(`Linked “${titleOf(shown.title)}”.`)
    }

    function pick(documentId: string) {
        const doc = documentById(documentId)
        if (!doc) return
        void link(documentId, {
            id: doc.id,
            title: doc.title,
            type: doc.type,
            aspect_type_id: doc.aspect_type_id,
            archived_at: null,
        })
    }

    async function unlink(item: LinkedDocument) {
        const ok = await feed.remove(item.id, async () => {
            const [ticket, document] = await Promise.all([settledId(props.ticketId), settledId(item.id)])
            if (!ticket.ok) return ticket
            if (!document.ok) return document
            return unlinkDocument(ticket.data, document.data)
        })
        if (ok) setAnnouncement(`Unlinked “${titleOf(item.title)}”.`)
    }

    return (
        <section class="links" aria-labelledby="ticket-documents-heading">
            <h2 id="ticket-documents-heading" class="t-section">
                Documents
            </h2>
            <Show
                when={feed.items().length > 0}
                fallback={
                    <p class="t-body links__none">
                        {feed.loaded() ? 'No documents linked.' : feed.loadProblem() ? '' : 'Loading documents…'}
                    </p>
                }
            >
                <ul class="links__list">
                    <For each={feed.items()} keyed={(item) => item.id}>
                        {(item) => (
                            <li class="links__item">
                                <a class="t-body" href={`/documents/${item().id}`}>
                                    {titleOf(item().title)}
                                </a>
                                <Show when={item().type === 'aspect'}>
                                    <span class="t-meta">Aspect</span>
                                </Show>
                                <Show when={item().archived_at}>
                                    <span class="t-meta">Archived</span>
                                </Show>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={props.disabled}
                                    aria-label={`Unlink ${titleOf(item().title)}`}
                                    onClick={() => void unlink(item())}
                                >
                                    Unlink
                                </Button>
                            </li>
                        )}
                    </For>
                </ul>
            </Show>
            <Show when={feed.loadProblem()}>
                <p class="t-meta links__none">Could not load the linked documents.</p>
            </Show>
            <Show when={feed.problem()}>
                {(message) => (
                    <p class="t-meta links__problem" role="alert">
                        {message()}
                    </p>
                )}
            </Show>
            <div class="links__actions">
                <Button variant="secondary" disabled={props.disabled} onClick={() => setPicking(true)}>
                    Link a document
                </Button>
                <Button variant="ghost" disabled={props.disabled} onClick={() => setMaking(true)}>
                    <Icon name="file-add" size={16} />
                    New document
                </Button>
            </div>
            <div class="visually-hidden" aria-live="polite">
                {announcement()}
            </div>

            <Show when={picking()}>
                <LinkPicker
                    title="Link a document"
                    noun="document"
                    options={candidates()}
                    onPick={pick}
                    onClose={() => setPicking(false)}
                />
            </Show>
            <Show when={making()}>
                <NewLinkedDocument
                    projectId={props.projectId}
                    onCreated={(documentId) => pick(documentId)}
                    onClose={() => setMaking(false)}
                />
            </Show>
        </section>
    )
}

type NewLinkedDocumentProps = {
    projectId: string
    /** The new document's id (temporary until the server answers). */
    onCreated: (documentId: string) => void
    onClose: () => void
}

function NewLinkedDocument(props: NewLinkedDocumentProps) {
    const [title, setTitle] = createSignal('')
    const [saving, setSaving] = createSignal(false)
    const over = () =>
        [...title().trim()].length > TITLE_MAX ? `Title can be at most ${TITLE_MAX} characters.` : undefined
    const blocked = () => saving() || title().trim() === '' || over() !== undefined

    async function create() {
        if (blocked()) return
        setSaving(true)
        const created = await createDocument({
            title: title().trim(),
            type: 'normal',
            aspect_type_id: null,
            team_id: null,
            project_id: props.projectId,
            body: { [CONTENT_KEY]: '' },
        })
        props.onCreated(created.id)
        props.onClose()
    }

    return (
        <Modal
            title="New document"
            consequence="It is saved like any document and linked to this ticket."
            confirm="Create and link"
            confirmDisabled={blocked()}
            onConfirm={() => void create()}
            onCancel={props.onClose}
        >
            <Input label="Title" value={title()} onInput={setTitle} required error={over()} />
        </Modal>
    )
}
