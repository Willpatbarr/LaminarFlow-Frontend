import { createEffect, createSignal, For, onCleanup, onSettled, Show, untrack } from 'solid-js'

import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { loadMembers, memberName } from '@/features/members/members'
import { RelativeTime } from '@/features/tickets/components/RelativeTime'
import { isTempId, resolveId } from '@/sync'

import { deleteAttachment, humanSize, listAttachments, uploadAttachment, type Attachment, type AttachmentParent } from './api'
import { oversizeMessage } from './limits'
import { attachmentsVersion, settledParent } from './upload'
import './attachments.css'

/*
┌─ attachments ───────────────────────────────────────
│  the Attachments section of the ticket and document pages (LAM-116)
├─ out ───────────────────────────────────────────────
│      AttachmentList   <AttachmentList parent={{ ticketId }} disabled />
*/
// Files are not synced: this list is asked for from the server (on opening, when
// the tab is shown again, after an upload or delete here or from an editor) and
// an upload or delete is a request whose answer is shown. Nothing is queued, so
// with no connection the section says so instead of pretending. Any member who
// can see the page may delete any of its attachments (the server enforces it).
//
// Files can be attached while the page's own row is still waiting to reach the
// server: the upload waits for it (up to 15 seconds) and says so.

type Props = {
    /** From the URL; may be a temporary id. */
    parent: AttachmentParent
    disabled?: boolean
}

const ANNOUNCEMENT_MS = 6000

type Sending = { id: number; name: string; fraction: number; waiting: boolean }

const idOf = (parent: AttachmentParent) => parent.ticketId ?? parent.documentId
// The parent under the id the server knows it by, as far as it does yet.
const ownerOf = (parent: AttachmentParent): AttachmentParent =>
    parent.ticketId !== undefined ? { ticketId: resolveId(parent.ticketId) } : { documentId: resolveId(parent.documentId) }
const noun = (parent: AttachmentParent) => (parent.ticketId !== undefined ? 'ticket' : 'document')

export function AttachmentList(props: Props) {
    const [items, setItems] = createSignal<Attachment[] | null>(null)
    const [loadProblem, setLoadProblem] = createSignal(false)
    const [sending, setSending] = createSignal<Sending[]>([])
    const [problems, setProblems] = createSignal<string[]>([])
    const [removing, setRemoving] = createSignal<Attachment | null>(null)
    // The last thing that went well ("Attached x."), shown and announced until it
    // is dismissed, replaced, or a few seconds pass. Errors stay until dismissed.
    const [announcement, setAnnouncement] = createSignal('')
    let announcementTimer: ReturnType<typeof setTimeout> | undefined
    let input: HTMLInputElement | undefined
    let latest = 0
    let seq = 0

    async function reload() {
        const owner = untrack(() => ownerOf(props.parent))
        if (isTempId(idOf(owner))) return
        const ticket = ++latest
        const result = await listAttachments(owner)
        if (ticket !== latest) return
        if (result.ok) {
            setItems(result.data)
            setLoadProblem(false)
        } else {
            setLoadProblem(true)
        }
    }

    onSettled(() => {
        void loadMembers()
    })

    createEffect(
        () => {
            const id = resolveId(idOf(props.parent))
            return isTempId(id) ? null : id
        },
        (id) => {
            setItems(null)
            if (!id) return
            void reload()
            const shown = () => {
                if (document.visibilityState !== 'hidden') void reload()
            }
            document.addEventListener('visibilitychange', shown)
            onCleanup(() => document.removeEventListener('visibilitychange', shown))
        },
    )

    // An image pasted into one of the page's editors.
    // (Not on mount: the effect above has just loaded the list, LAM-164.)
    let loadedVersion = untrack(attachmentsVersion)
    createEffect(
        () => attachmentsVersion(),
        (version) => {
            if (version === loadedVersion) return
            loadedVersion = version
            void reload()
        },
    )

    function announce(text: string) {
        clearTimeout(announcementTimer)
        setAnnouncement(text)
        if (text) announcementTimer = setTimeout(() => setAnnouncement(''), ANNOUNCEMENT_MS)
    }
    onCleanup(() => clearTimeout(announcementTimer))

    async function send(files: File[]) {
        // A new upload replaces whatever the last one said.
        setProblems([])
        announce('')
        for (const file of files) {
            // Over the limit: refuse before it waits or uploads anything.
            const tooBig = oversizeMessage(file)
            if (tooBig) {
                setProblems((all) => [...all, tooBig])
                continue
            }
            const id = ++seq
            const entry: Sending = { id, name: file.name, fraction: 0, waiting: isTempId(resolveId(idOf(props.parent))) }
            setSending((all) => [...all, entry])
            const owner = await settledParent(props.parent)
            if (!owner.ok) {
                setSending((all) => all.filter((s) => s.id !== id))
                setProblems((all) => [...all, owner.message])
                continue
            }
            setSending((all) => all.map((s) => (s.id === id ? { ...s, waiting: false } : s)))
            const result = await uploadAttachment(owner.data, file, {
                onProgress: (fraction) => setSending((all) => all.map((s) => (s.id === id ? { ...s, fraction } : s))),
            })
            setSending((all) => all.filter((s) => s.id !== id))
            if (result.ok) {
                announce(`Attached ${file.name}.`)
                await reload()
            } else {
                setProblems((all) => [...all, result.message])
            }
        }
    }

    async function remove(item: Attachment) {
        setRemoving(null)
        setProblems([])
        const result = await deleteAttachment(item.id)
        if (result.ok) {
            setItems((all) => all?.filter((a) => a.id !== item.id) ?? null)
            announce(`Deleted ${item.filename}.`)
        } else {
            setProblems((all) => [...all, `Could not delete ${item.filename}: ${result.message}`])
        }
    }

    const who = (item: Attachment) =>
        item.created_by === null ? 'a deleted account' : (memberName(item.created_by) ?? 'someone')

    return (
        <section class="attachments" aria-labelledby="attachments-heading">
            <h2 id="attachments-heading" class="t-section">
                Attachments
            </h2>

            <Show
                when={(items()?.length ?? 0) > 0}
                fallback={
                    <p class="t-body attachments__none">
                        {items() !== null ? 'No attachments.' : loadProblem() ? '' : isTempId(resolveId(idOf(props.parent))) ? '' : 'Loading attachments…'}
                    </p>
                }
            >
                <ul class="attachments__list">
                    <For each={items()!} keyed={(item) => item.id}>
                        {(item) => (
                            <li class="attachments__item" data-attachment-id={item().id}>
                                <a class="t-body attachments__name" href={item().url} download={item().filename}>
                                    {item().filename}
                                </a>
                                <span class="t-meta">
                                    {humanSize(item().size_bytes)} · {who(item())} · <RelativeTime at={item().created_at} />
                                </span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={props.disabled}
                                    aria-label={`Delete ${item().filename}`}
                                    onClick={() => setRemoving(item())}
                                >
                                    Delete
                                </Button>
                            </li>
                        )}
                    </For>
                </ul>
            </Show>

            <Show when={loadProblem()}>
                <p class="t-meta attachments__none">Could not load the attachments. They need a connection.</p>
            </Show>

            <Show when={sending().length > 0}>
                <div class="attachments__sending t-meta" role="status">
                    <For each={sending()} keyed={(s) => s.id}>
                        {(s) => (
                            <label class="attachments__upload">
                                <span>{s().waiting ? `Waiting for this ${noun(props.parent)} to be saved before uploading ${s().name}…` : `Uploading ${s().name}`}</span>
                                <Show when={!s().waiting}>
                                    <progress max="1" value={s().fraction} aria-label={`Uploading ${s().name}`} />
                                    <span>{Math.round(s().fraction * 100)}%</span>
                                </Show>
                            </label>
                        )}
                    </For>
                </div>
            </Show>

            <Show when={problems().length > 0}>
                <div class="attachments__problems" role="alert">
                    <For each={problems()}>{(text) => <p class="t-meta input__error">{text}</p>}</For>
                    <div>
                        <Button variant="ghost" size="sm" onClick={() => setProblems([])}>
                            Dismiss
                        </Button>
                    </div>
                </div>
            </Show>

            <div class="attachments__actions">
                <input
                    ref={(el) => {
                        input = el
                    }}
                    class="visually-hidden"
                    type="file"
                    multiple
                    tabindex="-1"
                    aria-label="Attach files"
                    onChange={(event) => {
                        const files = [...(event.currentTarget.files ?? [])]
                        event.currentTarget.value = ''
                        if (files.length > 0) void send(files)
                    }}
                />
                <Button variant="secondary" disabled={props.disabled} onClick={() => input?.click()}>
                    Attach a file
                </Button>
                <span class="t-meta">Needs a connection: files are uploaded right away, not queued.</span>
            </div>

            <div class="attachments__status t-meta" aria-live="polite" aria-atomic="true">
                <Show when={announcement()}>
                    <span>{announcement()}</span>
                    <Button variant="ghost" size="sm" aria-label="Dismiss message" onClick={() => announce('')}>
                        Dismiss
                    </Button>
                </Show>
            </div>

            <Show when={removing()}>
                {(item) => (
                    <Modal
                        title={`Delete ${item().filename}?`}
                        consequence="The file is removed for everyone. A Markdown image that points at it stops showing."
                        confirm="Delete"
                        destructive
                        onConfirm={() => void remove(item())}
                        onCancel={() => setRemoving(null)}
                    />
                )}
            </Show>
        </section>
    )
}
