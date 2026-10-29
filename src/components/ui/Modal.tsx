import { Portal, type JSX } from '@solidjs/web'
import { createUniqueId, onSettled, Show } from 'solid-js'

import { Button } from './Button'
import './Modal.css'

type ModalProps = {
    title: string
    /** The consequence, not the question restated: "2 tickets move to To Do"
     *  is what the reader needs in order to answer. */
    consequence?: string
    /** Anything the answer needs besides yes or no - a field to fill in. */
    children?: JSX.Element
    confirm: string
    cancel?: string
    /** Draws the confirm in the danger skin. */
    destructive?: boolean
    /** Greys the confirm out, while its work is under way or cannot start. */
    confirmDisabled?: boolean
    /** For content that cannot be shown again: Escape and a click on the
     *  backdrop do nothing and there is no Cancel, so the confirm is the only
     *  way out. */
    persistent?: boolean
    onConfirm: () => void
    /** Also called for Escape and a click on the backdrop. */
    onCancel: () => void
}

const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// From the Modal specimen: an overlay card whose footer steps *down* to
// --bg-base, so it separates without a divider line, with the shared Button
// for both actions.
//
// Mount it to open it and unmount it to close it (`<Show when={open()}>`); it
// holds no open state of its own. While mounted it keeps Tab inside itself,
// closes on Escape, and on unmount gives focus back to whatever had it.
//
// It is a <form>, so Enter in a field confirms.
export function Modal(props: ModalProps) {
    const titleId = createUniqueId()
    const consequenceId = `${titleId}-consequence`
    let panel: HTMLFormElement | undefined
    let cancelButton: HTMLButtonElement | undefined

    // Captured while the component is being created, before anything in it can
    // take focus: the control that opened the dialog.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

    onSettled(() => {
        // A field to fill in comes first. With none, Cancel: Enter on a
        // just-opened destructive confirmation must not be the destructive act.
        const field = panel?.querySelector<HTMLElement>('input, select, textarea')
        ;(field ?? cancelButton)?.focus()
        return () => {
            if (opener?.isConnected) opener.focus()
        }
    })

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            event.preventDefault()
            if (!props.persistent) props.onCancel()
            return
        }
        if (event.key !== 'Tab' || !panel) return
        const stops = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
        if (stops.length === 0) return
        const first = stops[0]
        const last = stops[stops.length - 1]
        const at = document.activeElement
        if (event.shiftKey && (at === first || !panel.contains(at))) {
            event.preventDefault()
            last.focus()
        } else if (!event.shiftKey && (at === last || !panel.contains(at))) {
            event.preventDefault()
            first.focus()
        }
    }

    return (
        <Portal>
            <div
                class="modal__backdrop"
                onKeyDown={onKeyDown}
                onClick={(event) => {
                    if (event.target === event.currentTarget && !props.persistent) props.onCancel()
                }}
            >
                <form
                    ref={(el) => {
                        panel = el
                    }}
                    class="modal"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={titleId}
                    aria-describedby={props.consequence ? consequenceId : undefined}
                    onSubmit={(event) => {
                        event.preventDefault()
                        if (!props.confirmDisabled) props.onConfirm()
                    }}
                >
                    <div class="modal__body">
                        <h2 id={titleId} class="modal__title t-section">
                            {props.title}
                        </h2>
                        <Show when={props.consequence}>
                            <p id={consequenceId} class="modal__consequence t-meta">
                                {props.consequence}
                            </p>
                        </Show>
                        {props.children}
                    </div>
                    <div class="modal__footer">
                        <Show when={!props.persistent}>
                            <Button
                                ref={(el) => {
                                    cancelButton = el
                                }}
                                variant="ghost"
                                onClick={() => props.onCancel()}
                            >
                                {props.cancel ?? 'Cancel'}
                            </Button>
                        </Show>
                        <Button
                            type="submit"
                            variant={props.destructive ? 'danger' : 'primary'}
                            disabled={props.confirmDisabled}
                        >
                            {props.confirm}
                        </Button>
                    </div>
                </form>
            </div>
        </Portal>
    )
}
