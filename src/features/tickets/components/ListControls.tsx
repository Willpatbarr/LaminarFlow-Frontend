import { createEffect, createSignal, For, onSettled, Show, untrack } from 'solid-js'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { ensureMembers, members } from '@/features/members/members'
import {
    epicsForProject,
    labelsForProject,
    milestonesForProject,
    sprintsForProject,
    statusesForProject,
    type Project,
} from '@/sync'

import { COLUMN_FIELDS, fieldLabel, GROUP_FIELDS, visibleColumns, type ListViewConfig } from '../listView/config'
import { fromGroup, PICK_FIELDS, toGroup, type FilterModel, type PickField } from '../listView/filterModel'
import type { Viewer } from '../viewer'

/*
┌─ tickets ───────────────────────────────────────
│  ListControls: the list's filter bar, sort, group and column picker (LAM-106)
├─ out ───────────────────────────────────────────
│      ListControls   <ListControls config={…} onChange={…} project={…} viewer={…} />
├─ example ───────────────────────────────────────
│      shows ListViewConfig and hands back a whole new one; where it is kept is the caller's
*/
// A controlled view of one `ListViewConfig`: it owns no view state beyond the
// text being typed. Every control builds a new config and calls `onChange`; the
// list writes it to the URL and reads it back. That one value is also what the
// saved views UI will save (LAM-118), so nothing here is private to the screen.

type ListControlsProps = {
    config: ListViewConfig
    onChange: (config: ListViewConfig) => void
    project: Project
    viewer: Viewer
    /** Only the search and the filter panel: a board has its columns on the
     *  board itself, and its cards in their own order (LAM-118). */
    filterOnly?: boolean
}

const TEXT_DELAY_MS = 250

type Option = { id: string; label: string }

const NONE_LABEL: Record<PickField, string> = {
    status: 'No status',
    assignee: 'Unassigned',
    epic: 'No epic',
    milestone: 'No milestone',
    label: 'No labels',
    sprint: 'No sprint',
}

const LEGEND: Record<PickField, string> = {
    status: 'Status',
    assignee: 'Assignee',
    epic: 'Epic',
    milestone: 'Milestone',
    label: 'Label',
    sprint: 'Sprint',
}

export function ListControls(props: ListControlsProps) {
    onSettled(() => void ensureMembers())
    const model = () => fromGroup(props.config.filter)
    const columns = () => visibleColumns(props.config)
    const sortKey = () => props.config.sort?.[0]
    // No sort is the list's own order, newest change first: the same thing as
    // sorting by "Updated", descending. One option stands for both (LAM-155),
    // so the direction button always has something to flip.
    const direction = () => sortKey() ?? { field: 'updated_at', desc: true }

    const [text, setText] = createSignal(untrack(() => model()?.text ?? ''))
    let timer: ReturnType<typeof setTimeout> | undefined
    // A link or the back button changed the filter: show it, unless the user is mid-word.
    createEffect(
        () => model()?.text ?? '',
        (next) => {
            if (timer === undefined) setText(next)
        },
    )

    // The panels' fields exist only while open: closed, they are not on the
    // page for anything to find, and the field labels ("Title", "Status") are
    // not repeated down a screen that already has those words in its rows.
    const [filterOpen, setFilterOpen] = createSignal(false)
    const [columnsOpen, setColumnsOpen] = createSignal(false)

    const set = (patch: Partial<ListViewConfig>) => props.onChange({ ...props.config, ...patch })
    const setModel = (next: FilterModel) => set({ filter: toGroup(next) })

    function typeText(value: string) {
        setText(value)
        clearTimeout(timer)
        timer = setTimeout(() => {
            timer = undefined
            const current = model()
            if (current) setModel({ ...current, text: value })
        }, TEXT_DELAY_MS)
    }

    function options(field: PickField): Option[] {
        const id = props.project.id
        switch (field) {
            case 'status':
                return statusesForProject(id).map((s) => ({ id: s.id, label: s.name }))
            case 'assignee':
                return [
                    { id: props.viewer.accountId, label: 'You' },
                    ...members()
                        .filter((m) => m.account_id !== props.viewer.accountId)
                        .map((m) => ({ id: m.account_id, label: m.display_name })),
                ]
            case 'epic':
                return epicsForProject(id).map((e) => ({ id: e.id, label: e.name }))
            case 'milestone':
                return milestonesForProject(id).map((m) => ({ id: m.id, label: m.name }))
            case 'label':
                return labelsForProject(id).map((l) => ({ id: l.id, label: l.name }))
            case 'sprint':
                return sprintsForProject(id).map((s) => ({ id: s.id, label: s.name }))
        }
    }

    // What is ticked but not known here (a link from another project, a
    // deleted epic) stays listed, so it can be seen and unticked.
    function choices(field: PickField, selected: string[]): Option[] {
        const known = options(field)
        const unknown = selected
            .filter((id) => !known.some((o) => o.id === id))
            .map((id) => ({ id, label: field === 'assignee' ? 'Someone else' : 'Unknown' }))
        return [...known, ...unknown]
    }

    function toggle(current: FilterModel, field: PickField, id: string | null, on: boolean) {
        const pick = current.picks[field]
        const next =
            id === null
                ? { ...pick, none: on }
                : { ...pick, ids: on ? [...pick.ids, id] : pick.ids.filter((x) => x !== id) }
        setModel({ ...current, picks: { ...current.picks, [field]: next } })
    }

    const activeCount = () => {
        const current = model()
        if (!current) return 1
        return (
            (current.text.trim() !== '' ? 1 : 0) +
            PICK_FIELDS.filter((f) => current.picks[f].ids.length > 0 || current.picks[f].none).length
        )
    }

    function pickColumn(field: string, on: boolean) {
        const next = COLUMN_FIELDS.filter((f) => f === 'title' || (f === field ? on : columns().includes(f)))
        set({ columns: next })
    }

    function pickSort(field: string) {
        set({ sort: field === '' ? undefined : [{ field, desc: sortKey()?.desc ?? false }] })
    }

    return (
        <div class="list-controls" role="group" aria-label={props.filterOnly ? 'Board filter' : 'List view'}>
            <div class="list-controls__row">
                <Show
                    when={model()}
                    fallback={
                        <p class="t-body list-controls__advanced">
                            This view uses an advanced filter. Clear it to use the search and filter panel.
                        </p>
                    }
                >
                    <div class="list-controls__search">
                        <Input
                            label="Search"
                            hideLabel
                            placeholder="Search"
                            value={text()}
                            onInput={typeText}
                        />
                    </div>
                </Show>
                <Show when={!props.filterOnly}>
                    <div class="list-controls__select">
                        <Select
                            label="Group by"
                            value={props.config.group ?? ''}
                            options={[
                                { value: '', label: 'No grouping' },
                                ...GROUP_FIELDS.map((f) => ({ value: f, label: fieldLabel(f) })),
                            ]}
                            onChange={(value) => set({ group: value === '' ? undefined : value })}
                        />
                    </div>
                    <div class="list-controls__select">
                        <Select
                            label="Sort by"
                            value={direction().field === 'updated_at' ? '' : direction().field}
                            options={[
                                { value: '', label: 'Recently updated' },
                                ...COLUMN_FIELDS.filter((f) => f !== 'updated_at').map((f) => ({
                                    value: f,
                                    label: fieldLabel(f),
                                })),
                            ]}
                            onChange={pickSort}
                        />
                    </div>
                    <div class="list-controls__direction">
                        <Button
                            variant="secondary"
                            aria-label={`Sort direction: ${direction().desc ? 'descending' : 'ascending'}`}
                            onClick={() => set({ sort: [{ field: direction().field, desc: !direction().desc }] })}
                        >
                            {direction().desc ? 'Descending' : 'Ascending'}
                        </Button>
                    </div>
                </Show>
                {/* Its room is kept whether or not it is showing, so it appearing
                    moves nothing. */}
                <div class="list-controls__clear">
                    <Show when={props.config.filter !== undefined}>
                        <Button variant="ghost" onClick={() => set({ filter: undefined })}>
                            Clear filters
                        </Button>
                    </Show>
                </div>
            </div>

            <div class="list-controls__row">
                <Show when={model()}>
                    {(current) => (
                        <details
                            class="list-controls__panel"
                            onToggle={(event) => setFilterOpen(event.currentTarget.open)}
                        >
                            <summary class="t-body">Filter{activeCount() > 0 ? ` (${activeCount()})` : ''}</summary>
                            <Show when={filterOpen()}>
                                <div class="list-controls__fields">
                                    <For each={PICK_FIELDS}>
                                        {(field) => (
                                            <fieldset class="list-controls__fieldset">
                                                <legend class="t-overline">{LEGEND[field]}</legend>
                                                <For each={choices(field, current().picks[field].ids)}>
                                                    {(option) => (
                                                        <label class="list-controls__check t-body">
                                                            <input
                                                                type="checkbox"
                                                                checked={current().picks[field].ids.includes(option.id)}
                                                                onChange={(event) =>
                                                                    toggle(
                                                                        current(),
                                                                        field,
                                                                        option.id,
                                                                        event.currentTarget.checked,
                                                                    )
                                                                }
                                                            />
                                                            {option.label}
                                                        </label>
                                                    )}
                                                </For>
                                                <label class="list-controls__check t-body">
                                                    <input
                                                        type="checkbox"
                                                        checked={current().picks[field].none}
                                                        onChange={(event) =>
                                                            toggle(current(), field, null, event.currentTarget.checked)
                                                        }
                                                    />
                                                    {NONE_LABEL[field]}
                                                </label>
                                            </fieldset>
                                        )}
                                    </For>
                                </div>
                            </Show>
                        </details>
                    )}
                </Show>
                <Show when={!props.filterOnly}>
                    <details class="list-controls__panel" onToggle={(event) => setColumnsOpen(event.currentTarget.open)}>
                        <summary class="t-body">Columns</summary>
                        <Show when={columnsOpen()}>
                            <fieldset class="list-controls__fieldset">
                                <legend class="visually-hidden">Visible columns</legend>
                                <For each={COLUMN_FIELDS}>
                                    {(field) => (
                                        <label class="list-controls__check t-body">
                                            <input
                                                type="checkbox"
                                                checked={columns().includes(field)}
                                                disabled={field === 'title'}
                                                onChange={(event) => pickColumn(field, event.currentTarget.checked)}
                                            />
                                            {fieldLabel(field)}
                                        </label>
                                    )}
                                </For>
                                <Show when={props.config.columns !== undefined}>
                                    <Button variant="ghost" size="sm" onClick={() => set({ columns: undefined })}>
                                        Reset columns
                                    </Button>
                                </Show>
                            </fieldset>
                        </Show>
                    </details>
                </Show>
            </div>
        </div>
    )
}
