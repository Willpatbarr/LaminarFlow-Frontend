import { createEffect, createSignal, For, Show } from 'solid-js'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { nameCount, overMessage } from '@/features/tickets/limits'
import '@/features/tickets/components/StatusEditor.css'

import { createAspectType, listAspectTypes, type AspectType } from '../api'

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

    return (
        <div class="status-editor">
            <Show when={problem()}>
                {(message) => (
                    <p class="status-editor__problem t-meta" role="alert">
                        {message()}
                    </p>
                )}
            </Show>
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
        </div>
    )
}
