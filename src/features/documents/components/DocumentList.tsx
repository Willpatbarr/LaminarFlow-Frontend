import { useNavigate } from '@solidjs/router'
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'

import { api } from '@/api/client'
import { can, denial } from '@/features/auth'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { RelativeTime } from '@/features/tickets/components/RelativeTime'
import { isLoading, sync, type Doc } from '@/sync'

import { makeDocument } from '../newDocument'
import './documents.css'

type DocumentListProps = {
    /** Fixes the list to one project (the project page's Documents tab): no project filter. */
    projectId?: string
    loading?: boolean
}

const ALL = ''
const NONE = 'none'

export const docTitle = (document: Doc) => document.title.trim() || 'Untitled'

// Documents are a synced entity, so the list reads the local store: what the
// server's `POST /documents/list` would return for live documents, plus the
// ones made offline that it has not seen yet, and it follows edits as they
// happen. Filters (all must match) are the endpoint's: project, type, aspect type.
export function DocumentList(props: DocumentListProps) {
    const navigate = useNavigate()
    const [project, setProject] = createSignal(ALL)
    const [type, setType] = createSignal(ALL)
    const [aspect, setAspect] = createSignal(ALL)
    const [creating, setCreating] = createSignal(false)
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
    async function create(aspectTypeId: string | null = null) {
        setCreating(true)
        try {
            const target = props.projectId ?? (project() !== ALL && project() !== NONE ? project() : null)
            await makeDocument(navigate, { aspectTypeId, projectId: target })
        } finally {
            setCreating(false)
        }
    }

    return (
        <div class="doclist" aria-busy={busy() ? 'true' : undefined}>
            <div class="doclist__filters">
                <Show when={props.projectId === undefined}>
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
                </Show>
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
                <Show when={aspectOptions().length > 1}>
                    <Select label="Aspect type" value={aspect()} onChange={setAspect} options={aspectOptions()} />
                </Show>
                <Button variant="primary" disabled={busy() || creating()} disabledReason={denial('ticket:write', 'create documents')} onClick={() => void create(null)}>
                    New document
                </Button>
                <Show when={Object.keys(aspectNames()).length > 0}>
                    <Select
                        label="New aspect"
                        value=""
                        disabled={busy() || creating() || !can('ticket:write')}
                        onChange={(value) => {
                            if (value) void create(value)
                        }}
                        options={[
                            { value: '', label: 'Choose a type…' },
                            ...Object.entries(aspectNames())
                                .map(([value, label]) => ({ value, label }))
                                .toSorted((a, b) => a.label.localeCompare(b.label)),
                        ]}
                    />
                </Show>
            </div>
            <Show when={busy()}>
                <p class="visually-hidden" role="status">
                    Loading documents…
                </p>
            </Show>
            <Show when={!busy()}>
                <Show
                    when={shown().length > 0}
                    fallback={
                        <p class="t-body">
                            {sync.documents.length === 0 ? 'No documents yet.' : 'No documents match these filters.'}
                        </p>
                    }
                >
                    <ul class="doclist__items" aria-label="Documents">
                        <For each={shown()} keyed={(document) => document.id}>
                            {(document) => (
                                <li class="doclist__item">
                                    <a class="t-body" href={`/documents/${document().id}`}>
                                        {docTitle(document())}
                                    </a>
                                    <span class="doclist__meta t-meta">
                                        <Show when={props.projectId === undefined}>
                                            <span>{projectName(document().project_id) ?? 'Team-wide'}</span>
                                        </Show>
                                        <span>
                                            {document().type === 'aspect'
                                                ? (aspectNames()[document().aspect_type_id ?? ''] ?? 'Aspect')
                                                : 'Document'}
                                        </span>
                                        <span>
                                            Updated <RelativeTime at={document().updated_at} />
                                        </span>
                                    </span>
                                </li>
                            )}
                        </For>
                    </ul>
                </Show>
            </Show>
        </div>
    )
}
