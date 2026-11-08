import type { JSX } from '@solidjs/web'
import { createMemo, createSignal, For, Show, untrack } from 'solid-js'

import { Icon } from '@/components/ui/icons/Icon'
import { Input } from '@/components/ui/Input'
import { ListBar, ListBars, MetaChip } from '@/components/ui/ListBar'
import { Modal } from '@/components/ui/Modal'
import { RowMenu, RowMenuItem } from '@/components/ui/RowMenu'
import { Select } from '@/components/ui/Select'
import { denial } from '@/features/auth'
import {
    createFolder,
    deleteFolder,
    foldersForProject,
    sync,
    updateDocument,
    updateFolder,
    type Doc,
    type DocFolder,
} from '@/sync'

import { buildTree, destinations, folderContents, insideOf, pathLabel, TOP_LEVEL, type FolderNode } from '../folderTree'

/*
┌─ documents ─────────────────────────────────────
│  FolderTree: a project's documents in their folders
├─ out ───────────────────────────────────────────
│      FolderTree      the tree: folders (collapsible) and documents, drag to move
│      FolderDialogs   new / rename / move / delete, as one modal at a time
│      FolderDialog    what FolderDialogs is showing
│      DocumentMenu    a document row's ⋯ menu ("Move to folder…")
*/
// Collapse is fine; hide is not. A folder is closed by default and remembered
// open per device, but every action has a visible home: each row's ⋯ menu. Drag
// and drop is the shortcut for "Move to…", never the only way.

export type FolderDialog =
    | { kind: 'new'; projectId: string; parentId: string | null }
    | { kind: 'rename'; folder: DocFolder }
    | { kind: 'move-folder'; folder: DocFolder }
    | { kind: 'move-document'; document: Doc }
    | { kind: 'delete'; folder: DocFolder }

const MAX_NAME = 100
const WRITE = () => denial('ticket:write', 'change documents')

// ── which folders are open, per device ──────────────────────────────────────

const OPEN_KEY = 'lf-doc-folders-open'
function readOpen(): Set<string> {
    try {
        const raw = localStorage.getItem(OPEN_KEY)
        const parsed: unknown = raw ? JSON.parse(raw) : []
        return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
    } catch {
        return new Set()
    }
}
const [openIds, setOpenIds] = createSignal<Set<string>>(readOpen())
function setOpen(id: string, open: boolean) {
    const next = new Set(openIds())
    if (open) next.add(id)
    else next.delete(id)
    setOpenIds(next)
    try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]))
    } catch {
        // Not remembered: the tree still works.
    }
}

// ── moving ──────────────────────────────────────────────────────────────────

type Dragged = { kind: 'document'; id: string } | { kind: 'folder'; id: string }
const [dragged, setDragged] = createSignal<Dragged | null>(null)

/** Files a document in a folder (null: the project's top level). */
export function moveDocument(document: Doc, folderId: string | null) {
    if ((document.folder_id ?? null) === folderId) return
    if (folderId) setOpen(folderId, true)
    void updateDocument(document.id, { folder_id: folderId }, { base: document.version, was: { folder_id: document.folder_id ?? null } })
}

function moveFolder(folder: DocFolder, parentId: string | null) {
    if (folder.parent_id === parentId) return
    if (parentId) setOpen(parentId, true)
    void updateFolder(folder.id, { parent_id: parentId })
}

function canDrop(item: Dragged | null, target: string | null, projectId: string): boolean {
    if (!item) return false
    if (item.kind === 'document') {
        const document = sync.documents.find((candidate) => candidate.id === item.id)
        return !!document && document.project_id === projectId && (document.folder_id ?? null) !== target
    }
    const folder = sync.folders.find((candidate) => candidate.id === item.id)
    if (!folder || folder.project_id !== projectId || folder.parent_id === target) return false
    return target === null || !insideOf(folder.id, sync.folders).has(target)
}

function drop(item: Dragged, target: string | null) {
    if (item.kind === 'document') {
        const document = sync.documents.find((candidate) => candidate.id === item.id)
        if (document) moveDocument(document, target)
    } else {
        const folder = sync.folders.find((candidate) => candidate.id === item.id)
        if (folder) moveFolder(folder, target)
    }
}

type DragHandlers = Pick<JSX.HTMLAttributes<HTMLLIElement>, 'draggable' | 'onDragStart' | 'onDragEnd'>
type DropHandlers = Pick<JSX.HTMLAttributes<HTMLElement>, 'onDragOver' | 'onDragLeave' | 'onDrop'>

/** What a row needs to be dragged, and (for a folder or the top level) dropped on. */
function dragProps(item: Dragged): DragHandlers {
    return {
        draggable: WRITE() ? 'false' : 'true',
        onDragStart: (event: DragEvent) => {
            event.dataTransfer?.setData('text/plain', item.id)
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
            setDragged(item)
        },
        onDragEnd: () => setDragged(null),
    }
}

function dropProps(
    target: () => string | null,
    projectId: () => string,
    setOver: (over: boolean) => void,
): DropHandlers {
    return {
        onDragOver: (event: DragEvent) => {
            if (!canDrop(dragged(), target(), projectId())) return
            event.preventDefault()
            event.stopPropagation()
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
            setOver(true)
        },
        onDragLeave: () => setOver(false),
        onDrop: (event: DragEvent) => {
            setOver(false)
            const item = dragged()
            if (!item || !canDrop(item, target(), projectId())) return
            event.preventDefault()
            event.stopPropagation()
            setDragged(null)
            drop(item, target())
        },
    }
}

// ── rows ────────────────────────────────────────────────────────────────────

const countLabel = (count: number) => (count === 1 ? '1 document' : `${count} documents`)

/** A document row's ⋯ menu. */
export function DocumentMenu(props: { document: Doc; title: string; onDialog: (dialog: FolderDialog) => void }) {
    return (
        <RowMenu label={`Actions for ${props.title}`}>
            <RowMenuItem
                disabledReason={WRITE() ?? (props.document.project_id ? undefined : 'Only a project’s documents go in folders')}
                onSelect={() => props.onDialog({ kind: 'move-document', document: props.document })}
            >
                Move to folder…
            </RowMenuItem>
        </RowMenu>
    )
}

type TreeProps = {
    projectId: string
    /** The documents to show, already filtered and in order. */
    documents: Doc[]
    /** Filters are on: folders with nothing that matches are left out, and the rest are open. */
    filtering: boolean
    title: (document: Doc) => string
    meta: (document: Doc) => JSX.Element
    onDialog: (dialog: FolderDialog) => void
    onNewDocument: (folderId: string) => void
}

export function FolderTree(props: TreeProps) {
    const tree = createMemo(() => buildTree(foldersForProject(props.projectId), props.documents))
    const [overTop, setOverTop] = createSignal(false)

    const documentRow = (document: () => Doc) => (
        <ListBar
            href={`/documents/${document().id}`}
            title={props.title(document())}
            meta={props.meta(document())}
            rowProps={dragProps({ kind: 'document', id: document().id })}
            actions={<DocumentMenu document={document()} title={props.title(document())} onDialog={props.onDialog} />}
        />
    )

    function FolderRows(rowProps: { nodes: FolderNode[]; depth: number }) {
        const shown = () => (props.filtering ? rowProps.nodes.filter((node) => node.total > 0) : rowProps.nodes)
        return (
            <For each={shown()} keyed={(node) => node.folder.id}>
                {(node) => {
                    const folder = () => node().folder
                    const open = () => props.filtering || openIds().has(folder().id)
                    const [over, setOver] = createSignal(false)
                    const empty = () => node().folders.length === 0 && node().documents.length === 0
                    return (
                        <>
                            <li
                                class="list-bar folder-row"
                                data-over={over() ? 'true' : undefined}
                                {...dragProps({ kind: 'folder', id: folder().id })}
                                {...dropProps(() => folder().id, () => props.projectId, setOver)}
                            >
                                <div class="list-bar__text">
                                    <button
                                        type="button"
                                        class="list-bar__title list-bar__link folder-row__toggle t-body"
                                        aria-expanded={open() ? 'true' : 'false'}
                                        onClick={() => setOpen(folder().id, !open())}
                                    >
                                        <Icon name={open() ? 'caret-down' : 'caret-right'} size={16} />
                                        <Icon name={open() ? 'folder-open' : 'folder'} size={16} />
                                        <span>{folder().name}</span>
                                    </button>
                                </div>
                                <span class="list-bar__meta">
                                    <MetaChip>{countLabel(node().total)}</MetaChip>
                                </span>
                                <span class="list-bar__actions">
                                    <RowMenu label={`Actions for folder ${folder().name}`}>
                                        <RowMenuItem disabledReason={WRITE()} onSelect={() => props.onNewDocument(folder().id)}>
                                            New document here
                                        </RowMenuItem>
                                        <RowMenuItem
                                            disabledReason={WRITE()}
                                            onSelect={() => props.onDialog({ kind: 'new', projectId: props.projectId, parentId: folder().id })}
                                        >
                                            New folder inside
                                        </RowMenuItem>
                                        <RowMenuItem disabledReason={WRITE()} onSelect={() => props.onDialog({ kind: 'rename', folder: folder() })}>
                                            Rename…
                                        </RowMenuItem>
                                        <RowMenuItem
                                            disabledReason={WRITE()}
                                            onSelect={() => props.onDialog({ kind: 'move-folder', folder: folder() })}
                                        >
                                            Move to…
                                        </RowMenuItem>
                                        <RowMenuItem
                                            destructive
                                            disabledReason={WRITE()}
                                            onSelect={() => props.onDialog({ kind: 'delete', folder: folder() })}
                                        >
                                            Delete folder…
                                        </RowMenuItem>
                                    </RowMenu>
                                </span>
                            </li>
                            <Show when={open()}>
                                <li class="folder-children">
                                    <ul class="list-bars" role="group" aria-label={`In ${folder().name}`}>
                                        <FolderRows nodes={node().folders} depth={rowProps.depth + 1} />
                                        <For each={node().documents} keyed={(document) => document.id}>
                                            {documentRow}
                                        </For>
                                        <Show when={empty()}>
                                            <li class="folder-children__empty t-meta">
                                                Empty. Drag a document here, or use its ⋯ menu.
                                            </li>
                                        </Show>
                                    </ul>
                                </li>
                            </Show>
                        </>
                    )
                }}
            </For>
        )
    }

    return (
        <div class="folder-tree">
            {/* While something is being dragged, a place to drop it out of every folder. */}
            <Show when={dragged() !== null && canDrop(dragged(), null, props.projectId)}>
                <div
                    class="folder-tree__top t-meta"
                    data-over={overTop() ? 'true' : undefined}
                    {...dropProps(() => null, () => props.projectId, setOverTop)}
                >
                    Drop here to move to the top level
                </div>
            </Show>
            <ListBars label="Documents">
                <FolderRows nodes={tree().folders} depth={0} />
                <For each={tree().documents} keyed={(document) => document.id}>
                    {documentRow}
                </For>
            </ListBars>
        </div>
    )
}

// ── dialogs ─────────────────────────────────────────────────────────────────

export function FolderDialogs(props: { dialog: FolderDialog | null; onClose: () => void }) {
    return (
        <Show when={props.dialog} keyed>
            {(dialog) => {
                switch (dialog.kind) {
                    case 'new':
                        return <NameDialog dialog={dialog} onClose={props.onClose} />
                    case 'rename':
                        return <NameDialog dialog={dialog} onClose={props.onClose} />
                    case 'move-folder':
                    case 'move-document':
                        return <MoveDialog dialog={dialog} onClose={props.onClose} />
                    case 'delete':
                        return <DeleteDialog folder={dialog.folder} onClose={props.onClose} />
                }
            }}
        </Show>
    )
}

function NameDialog(props: { dialog: Extract<FolderDialog, { kind: 'new' | 'rename' }>; onClose: () => void }) {
    // The dialog is what was asked for when it opened; it does not change under it.
    const dialog = untrack(() => props.dialog)
    const renaming = dialog.kind === 'rename'
    const [name, setName] = createSignal(dialog.kind === 'rename' ? dialog.folder.name : '')
    const length = () => [...name()].length
    const error = () => (length() > MAX_NAME ? `Keep it to ${MAX_NAME} characters.` : undefined)
    const where = () => {
        if (dialog.kind !== 'new' || !dialog.parentId) return undefined
        return `Inside ${pathLabel(dialog.parentId, sync.folders)}.`
    }

    async function confirm() {
        const value = name().trim()
        if (!value || error()) return
        if (dialog.kind === 'new') {
            if (dialog.parentId) setOpen(dialog.parentId, true)
            await createFolder({ project_id: dialog.projectId, parent_id: dialog.parentId, name: value })
        } else if (value !== dialog.folder.name) {
            await updateFolder(dialog.folder.id, { name: value })
        }
        props.onClose()
    }

    return (
        <Modal
            title={renaming ? 'Rename folder' : 'New folder'}
            consequence={where()}
            confirm={renaming ? 'Rename' : 'Create folder'}
            confirmDisabled={!name().trim() || !!error()}
            onConfirm={() => void confirm()}
            onCancel={props.onClose}
        >
            <Input label="Name" value={name()} onInput={setName} error={error()} />
        </Modal>
    )
}

function MoveDialog(props: { dialog: Extract<FolderDialog, { kind: 'move-folder' | 'move-document' }>; onClose: () => void }) {
    // What is being moved, and from where, as it was when the dialog opened.
    const { dialog, projectId, current, name } = untrack(() => {
        const dialog = props.dialog
        return {
            dialog,
            projectId: dialog.kind === 'move-folder' ? dialog.folder.project_id : (dialog.document.project_id ?? ''),
            current: dialog.kind === 'move-folder' ? dialog.folder.parent_id : (dialog.document.folder_id ?? null),
            name: dialog.kind === 'move-folder' ? dialog.folder.name : dialog.document.title.trim() || 'Untitled',
        }
    })
    const options = () =>
        destinations(foldersForProject(projectId), dialog.kind === 'move-folder' ? { folderId: dialog.folder.id } : {})
    const [target, setTarget] = createSignal(current ?? TOP_LEVEL)
    const projectName = () => sync.projects.find((project) => project.id === projectId)?.name

    function confirm() {
        const to = target() === TOP_LEVEL ? null : target()
        if (dialog.kind === 'move-folder') moveFolder(dialog.folder, to)
        else moveDocument(dialog.document, to)
        props.onClose()
    }

    return (
        <Modal
            title={`Move “${name}”`}
            consequence={projectName() ? `Folders of ${projectName()}.` : undefined}
            confirm="Move"
            confirmDisabled={target() === (current ?? TOP_LEVEL)}
            onConfirm={confirm}
            onCancel={props.onClose}
        >
            <Select label="Move to" value={target()} onChange={setTarget} options={options()} />
        </Modal>
    )
}

function DeleteDialog(props: { folder: DocFolder; onClose: () => void }) {
    const consequence = () => {
        const held = folderContents(props.folder.id, sync.folders, sync.documents)
        const parent = props.folder.parent_id ? pathLabel(props.folder.parent_id, sync.folders) : 'the top level'
        const parts = [
            held.documents > 0 ? countLabel(held.documents) : null,
            held.folders > 0 ? (held.folders === 1 ? '1 folder' : `${held.folders} folders`) : null,
        ].filter(Boolean)
        return parts.length === 0
            ? 'It is empty. Nothing else changes.'
            : `Its ${parts.join(' and ')} ${held.documents + held.folders === 1 ? 'moves' : 'move'} to ${parent}. Nothing is deleted.`
    }

    return (
        <Modal
            title={`Delete folder “${props.folder.name}”?`}
            consequence={consequence()}
            confirm="Delete folder"
            destructive
            onConfirm={() => {
                void deleteFolder(untrack(() => props.folder.id))
                props.onClose()
            }}
            onCancel={props.onClose}
        />
    )
}
