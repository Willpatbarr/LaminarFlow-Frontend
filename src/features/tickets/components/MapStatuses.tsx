import { createSignal, For } from 'solid-js'

import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { updateBoard, type Board, type Status } from '@/sync'

import { inOrder, suggestedColumn, withStatusIn } from '../board'

/*
┌─ tickets ───────────────────────────────────────
│  MapStatuses: place the statuses no column holds (LAM-202)
├─ out ───────────────────────────────────────────
│      MapStatuses   <MapStatuses board={…} unmapped={…} statuses={…} onClose={…} />
*/
// Opened by the board's "Map now". One picker per status that has tickets but no
// column; each starts on the column that holds the same category. Confirming writes
// the board's columns once, like any other column edit.

type MapStatusesProps = {
    board: Board
    unmapped: Status[]
    /** Every status of the team, for the category match. */
    statuses: Status[]
    onClose: () => void
}

export function MapStatuses(props: MapStatusesProps) {
    const columns = () => inOrder(props.board.columns)
    const [picked, setPicked] = createSignal<Record<string, string>>({})
    const choice = (status: Status) =>
        picked()[status.id] ?? suggestedColumn(props.board, status, props.statuses)?.id ?? ''

    function apply() {
        let next = props.board.columns
        for (const status of props.unmapped) {
            const target = choice(status)
            const edited = target ? withStatusIn(next, target, status.id, true) : null
            if (edited) next = edited
        }
        if (next !== props.board.columns) void updateBoard(props.board.id, { columns: next })
        props.onClose()
    }

    return (
        <Modal
            title="Show these statuses on the board"
            consequence="Their tickets appear in the column you pick. Nothing else changes."
            confirm="Map statuses"
            cancel="Cancel"
            onConfirm={apply}
            onCancel={props.onClose}
        >
            <For each={props.unmapped} keyed={(status) => status.id}>
                {(status) => (
                    <Select
                        label={`Column for ${status().name}`}
                        value={choice(status())}
                        options={columns().map((column) => ({ value: column.id, label: column.name }))}
                        onChange={(value) => setPicked({ ...picked(), [status().id]: value })}
                    />
                )}
            </For>
        </Modal>
    )
}
