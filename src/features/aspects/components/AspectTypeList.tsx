import { createEffect, createSignal, createUniqueId, For, Show } from 'solid-js'

import { Button } from '@/components/ui/Button'
import { Banner } from '@/components/ui/Banner'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { nameCount, overMessage } from '@/features/tickets/limits'
import '@/features/tickets/components/StatusEditor.css'

import { createAspectType, importAspectType, listAspectTypes, type AspectType } from '../api'
import { leaveImportNotice } from '../importNotice'
import { parsePortable, type Parsed } from '../portable'

/*
┌─ aspects ───────────────────────────────────────
│  AspectTypeList: a team's aspect types, starters included, and a form to make one (LAM-98)
├─ out ───────────────────────────────────────────
│      AspectTypeList   <AspectTypeList teamId={…} onOpen={(id) => …} />
*/
// Starter types are ordinary rows (LAM-43), so they list and edit like any other.
export function AspectTypeList(props: { teamId: string; onOpen: (id: string) => void }) {
    const [types, setTypes] = createSignal<AspectType[] | null>(null)
    const [problem, setProblem] = createSignal<string | null>(null)
    const [name, setName] = createSignal('')
    const [busy, setBusy] = createSignal(false)
    const [picked, setPicked] = createSignal<Extract<Parsed, { ok: true }>['file'] | null>(null)
    const [fileProblem, setFileProblem] = createSignal<string | null>(null)
    const [importing, setImporting] = createSignal(false)
    const fileId = createUniqueId()
    const tooLong = () => overMessage('Name', nameCount(name()))
    const blocked = () => name().trim() === '' || tooLong() !== undefined || busy()

    createEffect(
        () => props.teamId,
        (teamId) => {
            void listAspectTypes(teamId).then((result) => {
                if (result.ok) setTypes(result.data.items ?? [])
                else setProblem(result.message)
            })
        },
    )

    async function create() {
        if (blocked()) return
        setBusy(true)
        setProblem(null)
        const result = await createAspectType(props.teamId, name().trim())
        setBusy(false)
        if (!result.ok) return setProblem(result.message)
        setName('')
        props.onOpen(result.data.id)
    }

    async function choose(file: File | undefined) {
        if (!file) return
        setProblem(null)
        setFileProblem(null)
        const parsed = parsePortable(await file.text())
        if (parsed.ok) setPicked(parsed.file)
        else setFileProblem(`${file.name}: ${parsed.message}`)
    }

    async function confirmImport(file: NonNullable<ReturnType<typeof picked>>) {
        if (importing()) return
        setImporting(true)
        const result = await importAspectType(props.teamId, file)
        setImporting(false)
        setPicked(null)
        if (!result.ok) return setFileProblem(result.message)
        if (result.data.name !== file.name) {
            leaveImportNotice(`Imported as “${result.data.name}”: this team already had a type named “${file.name}”.`)
        }
        props.onOpen(result.data.id)
    }

    return (
        <div class="status-editor">
            <Show when={problem()}>
                {(message) => (
                    <p class="status-editor__problem t-meta" role="alert">
                        {message()}
                    </p>
                )}
            </Show>
            <Show when={fileProblem()}>
                {(message) => (
                    <Banner hue="rust" role="alert" onDismiss={() => setFileProblem(null)}>
                        {message()}
                    </Banner>
                )}
            </Show>
            <div>
                <Button variant="secondary" onClick={() => document.getElementById(fileId)?.click()}>
                    Import
                </Button>
                <input
                    id={fileId}
                    class="visually-hidden"
                    type="file"
                    accept=".json,application/json"
                    aria-label="Aspect type file"
                    tabindex={-1}
                    onChange={(event) => {
                        const input = event.currentTarget
                        void choose(input.files?.[0])
                        input.value = ''
                    }}
                />
            </div>
            <Show when={types()} fallback={<p class="t-meta" role="status">Loading aspect types…</p>}>
                {(list) => (
                    <>
                        <ul class="status-editor__list" aria-label="Aspect types">
                            <For each={list()} keyed={(item) => item.id}>
                                {(item) => (
                                    <li class="status-editor__row aspect-editor__type">
                                        <a href={`/teams/${props.teamId}/aspect-types/${item().id}`}>{item().name}</a>
                                    </li>
                                )}
                            </For>
                        </ul>
                        <Show when={list().length === 0}>
                            <p class="status-editor__empty t-meta">This team has no aspect types. Add one below.</p>
                        </Show>
                    </>
                )}
            </Show>
            <form
                class="aspect-editor__new"
                aria-label="Add an aspect type"
                onSubmit={(event) => {
                    event.preventDefault()
                    void create()
                }}
            >
                <Input label="New aspect type name" value={name()} onInput={setName} error={tooLong()} />
                <Button type="submit" disabled={blocked()}>
                    Add aspect type
                </Button>
            </form>
            <Show when={picked()} keyed>
                {(file) => (
                    <Modal
                        title={`Import “${file.name}”`}
                        consequence="This adds a new aspect type to the team. Nothing existing is changed; a name already in use gets a number after it."
                        confirm="Import"
                        confirmDisabled={importing()}
                        onConfirm={() => void confirmImport(file)}
                        onCancel={() => setPicked(null)}
                    >
                        <Show when={file.fields.length > 0} fallback={<p class="t-meta">No fields.</p>}>
                            <ol aria-label="Fields to import">
                                <For each={file.fields} keyed={(item) => item}>
                                    {(item) => <li>{item().label}</li>}
                                </For>
                            </ol>
                        </Show>
                    </Modal>
                )}
            </Show>
        </div>
    )
}
