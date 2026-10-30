import { createSignal, For, Show } from 'solid-js'

import { can, denial } from '@/features/auth'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { RowMenu, RowMenuItem } from '@/components/ui/RowMenu'
import { Select } from '@/components/ui/Select'
import { Icon } from '@/components/ui/icons/Icon'
import { useNarrowScreen } from '@/components/ui/useNarrowScreen'
import {
    createLabel,
    deleteLabel,
    discard,
    labelHead,
    labelsForTeam,
    sync,
    updateLabel,
    type Label,
} from '@/sync'

import { nameCount, overMessage } from '../limits'
import { COLOURS, hueFor } from '../statusLook'
import { LabelChip } from './LabelChips'
import './StatusEditor.css'

/*
┌─ tickets ───────────────────────────────────────
│  LabelEditor: create, rename, recolour and delete one team's labels (LAM-104)
│  NewLabel: the name-and-colour fields that make one; also used by the ticket page
├─ out ───────────────────────────────────────────
│      LabelEditor   <LabelEditor teamId={…} />  - a self-contained section
│      NewLabel      <NewLabel teamId={…} confirm="Add label" onAdd={…} />
│      labelNamed    a team's label of that name, ignoring case
*/
// Like the StatusEditor, it holds no copy of the labels: it reads
// `labelsForTeam` and writes through the sync engine's `label` entity, so a
// change shows at once, works offline and goes out in order. Labels have no
// position and no category: a name and a colour. The colour is one of the
// sheet's hues (see statusLook), stored as its hex.

/** The team's label with this name, if any. The server's rule is exact-match
 *  uniqueness; matching without case here keeps "bug" from sitting beside "Bug". */
export function labelNamed(teamId: string, name: string): Label | undefined {
    const wanted = name.trim().toLocaleLowerCase()
    return labelsForTeam(teamId).find((label) => label.name.toLocaleLowerCase() === wanted)
}

export function LabelEditor(props: { teamId: string }) {
    const labels = () => labelsForTeam(props.teamId)
    const [deleting, setDeleting] = createSignal<Label | null>(null)
    const using = (id: string) => sync.tickets.filter((ticket) => ticket.label_ids.includes(id)).length

    return (
        <section class="status-editor" aria-label="Labels">
            <ul class="status-editor__list label-editor__list" aria-label="Team labels">
                <For each={labels()} keyed={(label) => label.id}>
                    {(label) => <LabelRow label={label()} onDelete={() => setDeleting(label())} />}
                </For>
            </ul>
            <Show when={labels().length === 0}>
                <p class="status-editor__empty t-meta">This team has no labels. Add one below.</p>
            </Show>

            <NewLabel teamId={props.teamId} confirm="Add label" />

            <Show when={deleting()} keyed>
                {(label) => (
                    <Modal
                        title={`Delete “${label.name}”`}
                        consequence={
                            using(label.id) === 0
                                ? 'No ticket has this label.'
                                : `${using(label.id)} ${using(label.id) === 1 ? 'ticket has' : 'tickets have'} this label. It is removed from them.`
                        }
                        confirm="Delete label"
                        destructive
                        onConfirm={() => {
                            void deleteLabel(label.id)
                            setDeleting(null)
                        }}
                        onCancel={() => setDeleting(null)}
                    />
                )}
            </Show>
        </section>
    )
}

function LabelRow(props: { label: Label; onDelete: () => void }) {
    // The text being typed, or null while the row shows the saved name.
    const [draft, setDraft] = createSignal<string | null>(null)
    const narrow = useNarrowScreen()
    const head = () => labelHead(props.label.id)
    const name = () => draft() ?? props.label.name
    const tooLong = () => overMessage('Name', nameCount(name()))
    // The hue of the row; an older hex shows as the hue it is drawn in.
    const colour = () => hueFor(props.label.color)

    function commit() {
        const text = draft()?.trim()
        setDraft(null)
        if (text && text !== props.label.name && !overMessage('Name', nameCount(text))) {
            void updateLabel(props.label.id, { name: text })
        }
    }

    return (
        <li class="status-editor__row label-editor__row" data-compact={narrow() ? 'true' : undefined}>
            <LabelChip label={props.label} />
            <form
                class="status-editor__name"
                onSubmit={(event) => {
                    event.preventDefault()
                    commit()
                }}
            >
                <Input
                    label={`Name of ${props.label.name}`}
                    hideLabel
                    value={name()}
                    onInput={setDraft}
                    onBlur={commit}
                    readOnly={!can('ticket:write')}
                    error={tooLong()}
                />
            </form>
            <Show
                when={!narrow()}
                fallback={
                    <RowMenu label={`Actions for ${props.label.name}`}>
                        <p class="t-overline row-menu__head" aria-hidden="true">
                            Colour
                        </p>
                        <For each={COLOURS}>
                            {(option) => (
                                <RowMenuItem
                                    checked={colour() === option.value}
                                    label={`Colour ${option.label}`}
                                    disabledReason={denial('ticket:write', 'recolour labels')}
                                    onSelect={() => void updateLabel(props.label.id, { color: option.value })}
                                >
                                    <span class="row-menu__swatch" style={{ background: `var(--${option.value})` }} />
                                    {option.label}
                                    <Show when={colour() === option.value}>
                                        <Icon name="check" size={16} class="row-menu__check" />
                                    </Show>
                                </RowMenuItem>
                            )}
                        </For>
                        <hr class="row-menu__rule" />
                        <RowMenuItem destructive onSelect={() => props.onDelete()} disabledReason={denial('ticket:write', 'delete labels')}>
                            Delete
                        </RowMenuItem>
                    </RowMenu>
                }
            >
                <Select
                    label={`Colour of ${props.label.name}`}
                    hideLabel
                    value={colour()}
                    options={COLOURS}
                    onChange={(value) => void updateLabel(props.label.id, { color: value })}
                />
                <span class="status-editor__actions">
                    <Button variant="ghost" size="sm" disabledReason={denial('ticket:write', 'delete labels')} aria-label={`Delete ${props.label.name}`} onClick={() => props.onDelete()}>
                        Delete
                    </Button>
                </span>
            </Show>
            <Show when={head()?.state === 'failed' && head()} keyed>
                {(entry) => (
                    <p class="status-editor__problem t-meta" role="alert">
                        {entry.kind === 'archive' ? 'Not deleted' : 'Not saved'}:{' '}
                        {entry.error?.code === 'label_name_taken'
                            ? 'this team already has a label with that name.'
                            : (entry.error?.errors[0]?.message ?? 'the server refused this change.')}{' '}
                        <button type="button" class="status-editor__link" onClick={() => void discard(entry.id)}>
                            Undo this change
                        </button>
                    </p>
                )}
            </Show>
        </li>
    )
}

type NewLabelProps = {
    teamId: string
    /** The button's words. */
    confirm: string
    /** Called with the label once it is made (under its temporary id until the
     *  server answers), or with the existing one when the name is taken. */
    onAdd?: (label: Label) => void
}

// Not a <form>: the ticket page puts this inside its own form, and forms do not
// nest. Enter in the name field adds, as it would in a form.
export function NewLabel(props: NewLabelProps) {
    const [name, setName] = createSignal('')
    const [colour, setColour] = createSignal<string>(COLOURS[3].value)
    const taken = () => (name().trim() ? labelNamed(props.teamId, name()) : undefined)
    const tooLong = () => overMessage('Name', nameCount(name()))
    const blocked = () => name().trim() === '' || tooLong() !== undefined

    async function add() {
        const text = name().trim()
        if (blocked()) return
        setName('')
        // A name the team already has is that label, not a second one.
        const existing = labelNamed(props.teamId, text)
        const label = existing ?? (await createLabel({ team_id: props.teamId, name: text, color: colour() }))
        props.onAdd?.(label)
    }

    return (
        <div class="status-editor__new label-editor__new" role="group" aria-label="Add a label">
            <div
                onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    void add()
                }}
            >
                <Input label="New label name" value={name()} onInput={setName} error={tooLong()} />
            </div>
            <Select label="Label colour" value={colour()} options={COLOURS} onChange={setColour} />
            <Button type="button" disabled={blocked()} disabledReason={denial('ticket:write', 'add labels')} onClick={() => void add()}>
                {taken() ? `Use “${taken()!.name}”` : props.confirm}
            </Button>
        </div>
    )
}
