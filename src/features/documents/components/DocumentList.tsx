import { useLocation, useNavigate } from '@solidjs/router'
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'

import { api } from '@/api/client'
import { can, denial } from '@/features/auth'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/icons/Icon'
import { ListBar, ListBars, MetaChip } from '@/components/ui/ListBar'
import { PageActions } from '@/components/ui/PageLayout'
import { Popover } from '@/components/ui/Popover'
import { RowMenuItem } from '@/components/ui/RowMenu'
import { Select } from '@/components/ui/Select'
import { RelativeTime } from '@/features/tickets/components/RelativeTime'
import { foldersForProject, isLoading, sync, type Doc } from '@/sync'

import { pathLabel } from '../folderTree'
import { makeDocument } from '../newDocument'
import { filteredProjectId, NO_PROJECT, projectFilterOf, withProjectFilter } from '../projectFilter'
import { DocumentMenu, FolderDialogs, FolderTree, type FolderDialog } from './FolderTree'
import './documents.css'
import './folders.css'

type DocumentListProps = {
    /** Fixes the list to one project (the project page's Documents tab): no project filter. */
    projectId?: string
    loading?: boolean
}

const ALL = ''
const NONE = NO_PROJECT

export const docTitle = (document: Doc) => document.title.trim() || 'Untitled'

// Documents are a synced entity, so the list reads the local store: what the
// server's `POST /documents/list` would return for live documents, plus the
// ones made offline that it has not seen yet, and it follows edits as they
// happen. Filters (all must match) are the endpoint's: project, type, aspect type.
export function DocumentList(props: DocumentListProps) {
    const navigate = useNavigate()
    const location = useLocation()
    // The project filter is in the address (LAM-170), so a reload keeps it and the
    // command palette files "New document" under it too. Changing it is not a
    // place to go back to, so it replaces the entry.
    const project = () => projectFilterOf(location.search)
    const setProject = (value: string) =>
        navigate(`${location.pathname}${withProjectFilter(location.search, value)}`, { replace: true })
    const [type, setType] = createSignal(ALL)
    const [aspect, setAspect] = createSignal(ALL)
    const [creating, setCreating] = createSignal(false)
    const [dialog, setDialog] = createSignal<FolderDialog | null>(null)
    const [aspectNames, setAspectNames] = createSignal<Record<string, string>>({})
    const busy = () => props.loading || isLoading()

    // Aspect type names are not synced; ask for each team's once the teams are known.
    createEffect(
        () => sync.teams.map((team) => team.id).join(','),
        (ids) => {
            for (const teamId of ids.split(',').filter(Boolean)) {
                void api
                    .GET('/api/v1/aspect-types', { params: { query: { team_id: teamId } } })
                    .then((result) => {
                        const items = result.data?.items ?? []
                        if (items.length === 0) return
                        setAspectNames((names) => ({
                            ...names,
                            ...Object.fromEntries(items.map((item) => [item.id, item.name])),
                        }))
                    })
                    .catch(() => {})
            }
        },
    )

    const projectId = () => props.projectId ?? (project() === ALL ? null : project())
    // One project's documents are shown in their folders; every project's, as one list.
    const treeProject = () => props.projectId ?? filteredProjectId(location.search)
    const projectFolders = createMemo(() => {
        const id = treeProject()
        return id ? foldersForProject(id) : []
    })
    const projectName = (id: string | null) => sync.projects.find((candidate) => candidate.id === id)?.name

    const shown = createMemo(() =>
        sync.documents
            .filter((document) => {
                const wanted = projectId()
                if (wanted === NONE ? document.project_id !== null : wanted && document.project_id !== wanted) return false
                if (type() !== ALL && document.type !== type()) return false
                if (aspect() !== ALL && document.aspect_type_id !== aspect()) return false
                return true
            })
            .toSorted((a, b) => b.updated_at.localeCompare(a.updated_at)),
    )

    const aspectTypes = createMemo(() =>
        Object.entries(aspectNames())
            .map(([value, label]) => ({ value, label }))
            .toSorted((a, b) => a.label.localeCompare(b.label)),
    )

    const aspectOptions = createMemo(() => {
        const ids = [...new Set(sync.documents.map((document) => document.aspect_type_id).filter((id): id is string => !!id))]
        return [
            { value: ALL, label: 'All aspect types' },
            ...ids
                .map((id) => ({ value: id, label: aspectNames()[id] ?? 'Aspect type' }))
                .toSorted((a, b) => a.label.localeCompare(b.label)),
        ]
    })

    // A new document is normal, or an aspect of a type picked here. An aspect
    // starts with every field empty: an absent key is an empty field.
    const filtering = () => (props.projectId === undefined && project() !== ALL) || type() !== ALL || aspect() !== ALL
    const clearFilters = () => {
        if (props.projectId === undefined) setProject(ALL)
        setType(ALL)
        setAspect(ALL)
    }

    // The facts beside a document: where it is filed, what kind it is, when it changed.
    // In a project's tree the folder is where the row sits, so it is not said again.
    const meta = (document: Doc) => (
        <>
            <Show when={props.projectId === undefined && !treeProject()}>
                <MetaChip>{projectName(document.project_id) ?? 'Team-wide'}</MetaChip>
            </Show>
            <Show when={!treeProject() && document.folder_id && pathLabel(document.folder_id, sync.folders)}>
                {(path) => (
                    <MetaChip>
                        <Icon name="folder" size={12} /> {path()}
                    </MetaChip>
                )}
            </Show>
            <MetaChip>
                {document.type === 'aspect' ? (aspectNames()[document.aspect_type_id ?? ''] ?? 'Aspect') : 'Document'}
            </MetaChip>
            <MetaChip>
                Updated <RelativeTime at={document.updated_at} />
            </MetaChip>
        </>
    )

    async function create(aspectTypeId: string | null = null, folderId: string | null = null) {
        setCreating(true)
        try {
            const target = props.projectId ?? filteredProjectId(location.search)
            await makeDocument(navigate, { aspectTypeId, projectId: target, folderId })
        } finally {
            setCreating(false)
        }
    }

    return (
        <div class="doclist" aria-busy={busy() ? 'true' : undefined}>
            <div class="doclist__toolbar" role="group" aria-label="Document filters">
                <Show when={props.projectId === undefined}>
                    <div class="doclist__select">
                        <Select
                            label="Project"
                            value={project()}
                            onChange={setProject}
                            options={[
                                { value: ALL, label: 'All projects' },
                                ...sync.projects
                                    .toSorted((a, b) => a.name.localeCompare(b.name))
                                    .map((candidate) => ({ value: candidate.id, label: candidate.name })),
                                { value: NONE, label: 'Team-wide (no project)' },
                            ]}
                        />
                    </div>
                </Show>
                <div class="doclist__select">
                    <Select
                        label="Type"
                        value={type()}
                        onChange={setType}
                        options={[
                            { value: ALL, label: 'All types' },
                            { value: 'normal', label: 'Document' },
                            { value: 'aspect', label: 'Aspect' },
                        ]}
                    />
                </div>
                <Show when={aspectOptions().length > 1}>
                    <div class="doclist__select">
                        <Select label="Aspect type" value={aspect()} onChange={setAspect} options={aspectOptions()} />
                    </div>
                </Show>
                {/* Its room is kept whether or not it is showing, so it appearing moves nothing. */}
                <div class="doclist__clear">
                    <Show when={filtering()}>
                        <Button variant="ghost" onClick={clearFilters}>
                            Clear filters
                        </Button>
                    </Show>
                </div>
            </div>
            <PageActions>
                <div class="doclist__actions">
                    {/* A split button: New document, and beside it a menu of aspect
                        types to start one from. The menu is shown whenever there is
                        a type to pick, so nothing is hidden, only folded in. */}
                    <div class="doclist__split">
                        <Button
                            variant="primary"
                            disabled={busy() || creating()}
                            disabledReason={denial('ticket:write', 'create documents')}
                            onClick={() => void create(null)}
                        >
                            <Icon name="file-add" size={16} />
                            New document
                        </Button>
                        <Show when={aspectTypes().length > 0}>
                            <Popover
                                label="New aspect"
                                role="menu"
                                presentation="auto"
                                trigger={(trigger) => (
                                    <button
                                        type="button"
                                        class="button button--primary doclist__more"
                                        aria-label="New aspect: choose a type"
                                        disabled={busy() || creating() || !can('ticket:write')}
                                        {...trigger}
                                    >
                                        <Icon name="caret-down" size={16} />
                                    </button>
                                )}
                            >
                                <div class="row-menu">
                                    <p class="row-menu__head t-overline">New aspect</p>
                                    <For each={aspectTypes()} keyed={(entry) => entry.value}>
                                        {(entry) => (
                                            <RowMenuItem onSelect={() => void create(entry().value)}>
                                                {entry().label}
                                            </RowMenuItem>
                                        )}
                                    </For>
                                </div>
                            </Popover>
                        </Show>
                    </div>
                    <Button
                        variant="secondary"
                        disabled={busy()}
                        disabledReason={
                            denial('ticket:write', 'create folders') ??
                            (treeProject() ? undefined : 'Pick a project first: folders belong to a project')
                        }
                        onClick={() => {
                            const id = treeProject()
                            if (id) setDialog({ kind: 'new', projectId: id, parentId: null })
                        }}
                    >
                        <Icon name="folder-add" size={16} />
                        New folder
                    </Button>
                </div>
            </PageActions>
            <FolderDialogs dialog={dialog()} onClose={() => setDialog(null)} />
            <Show when={busy()}>
                <p class="visually-hidden" role="status">
                    Loading documents…
                </p>
            </Show>
            <Show when={!busy()}>
                <Show
                    when={shown().length > 0 || (projectFolders().length > 0 && type() === ALL && aspect() === ALL)}
                    fallback={
                        <div class="doclist__empty">
                            <Show
                                when={sync.documents.length === 0}
                                fallback={
                                    <>
                                        <p class="t-section">No documents match these filters</p>
                                        <p class="t-body">Change or clear the filters to see more.</p>
                                    </>
                                }
                            >
                                <p class="t-section">No documents yet</p>
                                <p class="t-body">
                                    Create the first one with “New document”
                                    {aspectTypes().length > 0 ? ', or start an aspect from the arrow beside it.' : '.'}
                                </p>
                            </Show>
                        </div>
                    }
                >
                    <Show
                        when={treeProject()}
                        fallback={
                            <ListBars label="Documents">
                                <For each={shown()} keyed={(document) => document.id}>
                                    {(document) => (
                                        <ListBar
                                            href={`/documents/${document().id}`}
                                            title={docTitle(document())}
                                            meta={meta(document())}
                                            actions={
                                                <DocumentMenu
                                                    document={document()}
                                                    title={docTitle(document())}
                                                    onDialog={setDialog}
                                                />
                                            }
                                        />
                                    )}
                                </For>
                            </ListBars>
                        }
                    >
                        {(id) => (
                            <FolderTree
                                projectId={id()}
                                documents={shown()}
                                filtering={type() !== ALL || aspect() !== ALL}
                                title={docTitle}
                                meta={meta}
                                onDialog={setDialog}
                                onNewDocument={(folderId) => void create(null, folderId)}
                            />
                        )}
                    </Show>
                </Show>
            </Show>
        </div>
    )
}
