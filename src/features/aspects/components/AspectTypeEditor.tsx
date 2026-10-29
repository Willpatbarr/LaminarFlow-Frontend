import { createEffect, createSignal, For, Show } from 'solid-js'

import { Banner } from '@/components/ui/Banner'
import { can, denial } from '@/features/auth'
import { Button } from '@/components/ui/Button'
import { MoveButtons } from '@/components/ui/MoveButtons'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { nameCount, overMessage } from '@/features/tickets/limits'
import '@/features/tickets/components/StatusEditor.css'

import {
    addField,
    exportAspectType,
    fieldUsage,
    getAspectType,
    removeField,
    renameAspectType,
    renameField,
    reorderFields,
    type AspectField,
    type AspectType,
    type Result,
} from '../api'
import { takeImportNotice } from '../importNotice'
import { downloadJson, exportFileName } from '../portable'

/*
┌─ aspects ───────────────────────────────────────
│  AspectTypeEditor: rename one aspect type, add, relabel, reorder and remove its fields (LAM-98)
├─ out ───────────────────────────────────────────
│      AspectTypeEditor   <AspectTypeEditor typeId={…} />
*/
// Every change is a request and the screen shows the server's answer: field
// edits are row operations, so nothing here rewrites a document. A field that
// documents have filled in keeps those values in their bodies after it is
// removed; they stop rendering, which is why the removal asks first and says
// how many there are.
//
// Reorder: drag the handle, or the Move buttons - dragging has no keyboard form
// of its own. No drag library is installed and none is added; this is the native
// HTML drag the status editor uses.

type Removal = { field: AspectField; documents: number }

export function AspectTypeEditor(props: { typeId: string }) {
    const [type, setType] = createSignal<AspectType | null>(null)
    const [loading, setLoading] = createSignal(true)
    const [problem, setProblem] = createSignal<string | null>(null)
    const [missing, setMissing] = createSignal(false)
    const [name, setName] = createSignal<string | null>(null)
    const [newLabel, setNewLabel] = createSignal('')
    const [removal, setRemoval] = createSignal<Removal | null>(null)
    const [dragging, setDragging] = createSignal<string | null>(null)
    const [busy, setBusy] = createSignal(false)

    const [notice, setNotice] = createSignal<string | null>(takeImportNotice())

    const fields = () => type()?.fields ?? []

    async function exportJson() {
        const current = type()
        if (!current) return
        const exported = await attempt(() => exportAspectType(current.id))
        if (!exported) return
        // The body carries a `$schema` pointer to the server's JSON Schema; the file is the shape alone.
        const { $schema: _pointer, ...file } = exported
        downloadJson(exportFileName(current.name), file)
    }

    async function load(id: string) {
        setLoading(true)
        const result = await getAspectType(id)
        setLoading(false)
        if (result.ok) {
            setType(result.data)
            setMissing(false)
        } else if (result.code === 'aspect_type_not_found') {
            setMissing(true)
        } else {
            setProblem(result.message)
        }
    }

    createEffect(
        () => props.typeId,
        (id) => {
            setType(null)
            setProblem(null)
            void load(id)
        },
    )

    /** Runs one request; on failure shows why and returns undefined. */
    async function attempt<T>(call: () => Promise<Result<T>>): Promise<T | undefined> {
        setProblem(null)
        const result = await call()
        if (result.ok) return result.data
        setProblem(result.message)
        return undefined
    }

    async function commitName() {
        const text = name()?.trim()
        setName(null)
        const current = type()
        if (!current || !text || text === current.name || overMessage('Name', nameCount(text))) return
        const renamed = await attempt(() => renameAspectType(current.id, text))
        if (renamed) setType((previous) => (previous ? { ...previous, name: renamed.name } : previous))
    }

    async function add() {
        const label = newLabel().trim()
        if (!label || busy()) return
        setBusy(true)
        const created = await attempt(() => addField(props.typeId, label))
        setBusy(false)
        if (!created) return
        setNewLabel('')
        setType((previous) => (previous ? { ...previous, fields: [...(previous.fields ?? []), created] } : previous))
    }

    async function relabel(field: AspectField, label: string) {
        const text = label.trim()
        if (!text || text === field.label) return
        const renamed = await attempt(() => renameField(props.typeId, field.id, text))
        if (!renamed) return
        setType((previous) =>
            previous
                ? { ...previous, fields: (previous.fields ?? []).map((f) => (f.id === renamed.id ? renamed : f)) }
                : previous,
        )
    }

    /** Moves a field to an index. The list is sent whole; a 409 means another
     *  tab changed the set, so refetch and say so rather than overwrite it. */
    async function place(fieldId: string, to: number) {
        const current = fields()
        const from = current.findIndex((field) => field.id === fieldId)
        if (from < 0 || to < 0 || to >= current.length || to === from) return
        const next = [...current]
        next.splice(to, 0, next.splice(from, 1)[0])
        setProblem(null)
        const result = await reorderFields(props.typeId, next.map((field) => field.id))
        if (result.ok) {
            setType(result.data)
            return
        }
        if (result.code === 'field_set_mismatch') {
            await load(props.typeId)
            setProblem('The fields changed elsewhere. They have been reloaded; move this one again.')
            return
        }
        setProblem(result.message)
    }

    async function askToRemove(field: AspectField) {
        setProblem(null)
        const usage = await attempt(() => fieldUsage(props.typeId, field.id))
        if (usage) setRemoval({ field, documents: usage.document_count })
    }

    async function confirmRemove(field: AspectField) {
        setRemoval(null)
        const done = await attempt(() => removeField(props.typeId, field.id))
        if (done === undefined) return
        setType((previous) =>
            previous ? { ...previous, fields: (previous.fields ?? []).filter((f) => f.id !== field.id) } : previous,
        )
    }

    const nameError = () => overMessage('Name', nameCount(name() ?? ''))

    return (
        <section aria-busy={loading() ? 'true' : undefined}>
            <Show when={problem()}>
                {(message) => (
                    <Banner hue="rust" role="alert" onDismiss={() => setProblem(null)}>
                        {message()}
                    </Banner>
                )}
            </Show>
            <Show when={notice()}>
                {(message) => (
                    <Banner hue="amber" onDismiss={() => setNotice(null)}>
                        {message()}
                    </Banner>
                )}
            </Show>
            <Show when={!missing()} fallback={<p class="t-body">This aspect type does not exist.</p>}>
                <Show
                    when={type()}
                    fallback={
                        <p class="t-meta" role="status">
                            {loading() ? 'Loading aspect type…' : 'Could not load this aspect type.'}
                        </p>
                    }
                >
                    {(current) => (
                        <div class="status-editor">
                            <form
                                onSubmit={(event) => {
                                    event.preventDefault()
                                    void commitName()
                                }}
                            >
                                <Input
                                    label="Aspect type name"
                                    value={name() ?? current().name}
                                    onInput={setName}
                                    onBlur={() => void commitName()}
                                    readOnly={!can('aspect:write')}
                                    error={nameError()}
                                />
                            </form>

                            <div>
                                <Button variant="secondary" onClick={() => void exportJson()}>
                                    Export JSON
                                </Button>
                            </div>

                            <h2 class="t-section">Fields</h2>
                            <ul class="status-editor__list" aria-label="Fields">
                                <For each={fields()} keyed={(field) => field.id}>
                                    {(field, index) => (
                                        <FieldRow
                                            field={field()}
                                            first={index() === 0}
                                            last={index() === fields().length - 1}
                                            dragging={dragging() === field().id}
                                            onDragStart={() => setDragging(field().id)}
                                            onDragEnd={() => setDragging(null)}
                                            onDrop={() => {
                                                const moved = dragging()
                                                setDragging(null)
                                                if (moved && moved !== field().id) void place(moved, index())
                                            }}
                                            onMove={(by) => void place(field().id, index() + by)}
                                            onLabel={(label) => void relabel(field(), label)}
                                            onRemove={() => void askToRemove(field())}
                                        />
                                    )}
                                </For>
                            </ul>
                            <Show when={fields().length === 0}>
                                <p class="status-editor__empty t-meta">
                                    This type has no fields yet. A document of it is a title and nothing else.
                                </p>
                            </Show>

                            <div
                                class="aspect-editor__new"
                                role="group"
                                aria-label="Add a field"
                                onKeyDown={(event) => {
                                    if (event.key !== 'Enter') return
                                    event.preventDefault()
                                    void add()
                                }}
                            >
                                <Input label="New field label" value={newLabel()} onInput={setNewLabel} readOnly={!can('aspect:write')} />
                                <Button
                                    disabled={newLabel().trim() === '' || busy()}
                                    disabledReason={denial('aspect:write', 'add fields')}
                                    onClick={() => void add()}>
                                    Add field
                                </Button>
                            </div>
                        </div>
                    )}
                </Show>
            </Show>

            <Show when={removal()} keyed>
                {(pending) => (
                    <Modal
                        title={`Remove “${pending.field.label}”`}
                        consequence={
                            pending.documents === 0
                                ? 'No document has a value in this field.'
                                : `${pending.documents} ${pending.documents === 1 ? 'document has' : 'documents have'} a value in this field. The values stay stored but stop showing.`
                        }
                        confirm="Remove field"
                        destructive
                        onConfirm={() => void confirmRemove(pending.field)}
                        onCancel={() => setRemoval(null)}
                    />
                )}
            </Show>
        </section>
    )
}

type FieldRowProps = {
    field: AspectField
    first: boolean
    last: boolean
    dragging: boolean
    onDragStart: () => void
    onDragEnd: () => void
    onDrop: () => void
    onMove: (by: number) => void
    onLabel: (label: string) => void
    onRemove: () => void
}

function FieldRow(props: FieldRowProps) {
    const [draft, setDraft] = createSignal<string | null>(null)
    const label = () => draft() ?? props.field.label

    function commit() {
        const text = draft()
        setDraft(null)
        if (text !== null) props.onLabel(text)
    }

    return (
        <li
            class="status-editor__row aspect-editor__row"
            data-dragging={props.dragging ? 'true' : undefined}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
                event.preventDefault()
                props.onDrop()
            }}
        >
            <span
                class="status-editor__handle"
                draggable="true"
                aria-hidden="true"
                title="Drag to reorder"
                onDragStart={(event) => {
                    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
                    props.onDragStart()
                }}
                onDragEnd={() => props.onDragEnd()}
            >
                ⠿
            </span>
            <form
                class="status-editor__name"
                onSubmit={(event) => {
                    event.preventDefault()
                    commit()
                }}
            >
                <Input
                    label={`Label of ${props.field.label}`}
                    hideLabel
                    value={label()}
                    onInput={setDraft}
                    onBlur={commit}
                    readOnly={!can('aspect:write')}
                />
            </form>
            <span class="status-editor__actions">
                <MoveButtons name={props.field.label} first={props.first} last={props.last} disabledReason={denial('aspect:write', 'change fields')} onMove={props.onMove} />
                <Button variant="ghost" size="sm" disabledReason={denial('aspect:write', 'remove fields')} aria-label={`Remove ${props.field.label}`} onClick={() => props.onRemove()}>
                    Remove
                </Button>
            </span>
        </li>
    )
}
