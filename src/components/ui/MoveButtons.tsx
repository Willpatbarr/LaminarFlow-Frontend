import { Button } from './Button'

type MoveButtonsProps = {
    /** What is being moved, for the accessible names: "Move <name> up". */
    name: string
    first: boolean
    last: boolean
    /** -1 moves it up, 1 moves it down. */
    onMove: (delta: -1 | 1) => void
    /** Disables both and says why (a permission), taking precedence over
     *  "Already first" / "Already last". */
    disabledReason?: string
}

// The reorder pair for a row in an editable list. A button at the end of the
// list is disabled but stays visible, with a tooltip saying why: collapse is
// fine, hide is not.
export function MoveButtons(props: MoveButtonsProps) {
    return (
        <>
            <Button
                variant="ghost"
                size="sm"
                disabledReason={props.disabledReason ?? (props.first ? 'Already first' : undefined)}
                aria-label={`Move ${props.name} up`}
                onClick={() => props.onMove(-1)}>
                ↑
            </Button>
            <Button
                variant="ghost"
                size="sm"
                disabledReason={props.disabledReason ?? (props.last ? 'Already last' : undefined)}
                aria-label={`Move ${props.name} down`}
                onClick={() => props.onMove(1)}>
                ↓
            </Button>
        </>
    )
}
