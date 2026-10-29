import { createMemo, createSignal, For, Show } from 'solid-js'

import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'

/*
┌─ links ─────────────────────────────────────────
│  LinkPicker: a searchable list of things to link, in a dialog
├─ out ───────────────────────────────────────────
│      LinkPicker   <LinkPicker title="Link a document" noun="document" options onPick onClose />
*/
// The options come from the local store, so it works offline and searches as
// you type. One is chosen with a radio button and confirmed, so a slip of the
// mouse links nothing. At most `SHOWN` are listed; narrowing the search brings
// the rest.

const SHOWN = 50

export type PickOption = { id: string; label: string; hint?: string }

type LinkPickerProps = {
    title: string
    /** "document": names the search field and the empty message. */
    noun: string
    options: PickOption[]
    onPick: (id: string) => void
    onClose: () => void
}

export function LinkPicker(props: LinkPickerProps) {
    const [query, setQuery] = createSignal('')
    const [chosen, setChosen] = createSignal<string | null>(null)

    const matches = createMemo(() => {
        const needle = query().trim().toLowerCase()
        return props.options.filter((option) => needle === '' || option.label.toLowerCase().includes(needle))
    })
    const shown = () => matches().slice(0, SHOWN)

    return (
        <Modal
            title={props.title}
            confirm="Link"
            confirmDisabled={chosen() === null}
            onConfirm={() => {
                const id = chosen()
                if (id === null) return
                props.onPick(id)
                props.onClose()
            }}
            onCancel={props.onClose}
        >
            <Input label={`Search ${props.noun}s`} value={query()} onInput={setQuery} />
            <fieldset class="link-picker__list">
                <legend class="visually-hidden">{`Matching ${props.noun}s`}</legend>
                <Show
                    when={shown().length > 0}
                    fallback={<p class="t-body link-picker__none">{`No ${props.noun}s to link.`}</p>}
                >
                    <For each={shown()} keyed={(option) => option.id}>
                        {(option) => (
                            <label class="link-picker__option t-body">
                                <input
                                    type="radio"
                                    name="link-picker"
                                    checked={chosen() === option().id}
                                    onChange={() => setChosen(option().id)}
                                />
                                <span>{option().label}</span>
                                <Show when={option().hint}>
                                    <span class="t-meta">{option().hint}</span>
                                </Show>
                            </label>
                        )}
                    </For>
                </Show>
                <Show when={matches().length > SHOWN}>
                    <p class="t-meta">{`Showing ${SHOWN} of ${matches().length}. Type to narrow the list.`}</p>
                </Show>
            </fieldset>
        </Modal>
    )
}
