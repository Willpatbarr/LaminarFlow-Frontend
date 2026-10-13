import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { createSignal, Show } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'

import { Input } from './Input'
import { Modal } from './Modal'

// The way a screen uses it: a button opens it, and it is mounted while open.
function Harness(props: { onConfirm?: () => void; withField?: boolean; confirmDisabled?: boolean }) {
    const [open, setOpen] = createSignal(false)
    const [text, setText] = createSignal('')
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>
                Open
            </button>
            <Show when={open()}>
                <Modal
                    title="Delete status?"
                    consequence="2 tickets move to To Do."
                    confirm="Delete"
                    destructive
                    confirmDisabled={props.confirmDisabled}
                    onConfirm={() => {
                        props.onConfirm?.()
                        setOpen(false)
                    }}
                    onCancel={() => setOpen(false)}
                >
                    <Show when={props.withField}>
                        <Input label="Name" value={text()} onInput={setText} />
                    </Show>
                </Modal>
            </Show>
        </>
    )
}

describe('Modal', () => {
    it('is a labelled, described modal dialog', async () => {
        render(() => <Harness />)
        await userEvent.click(screen.getByRole('button', { name: 'Open' }))

        const dialog = screen.getByRole('dialog', { name: 'Delete status?' })
        expect(dialog).toHaveAttribute('aria-modal', 'true')
        expect(dialog).toHaveAccessibleDescription('2 tickets move to To Do.')
    })

    it('starts on Cancel, so Enter on a just-opened destructive dialog is not the destructive act', async () => {
        const onConfirm = vi.fn()
        render(() => <Harness onConfirm={onConfirm} />)
        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: 'Open' }))

        expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
        await user.keyboard('{Enter}')

        expect(onConfirm).not.toHaveBeenCalled()
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('starts in the field when it has one, and Enter there confirms', async () => {
        const onConfirm = vi.fn()
        render(() => <Harness onConfirm={onConfirm} withField />)
        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: 'Open' }))

        expect(screen.getByLabelText('Name')).toHaveFocus()
        await user.keyboard('abc{Enter}')

        expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    it('keeps Tab inside the dialog, in both directions', async () => {
        render(() => <Harness />)
        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: 'Open' }))
        const cancel = screen.getByRole('button', { name: 'Cancel' })
        const confirm = screen.getByRole('button', { name: 'Delete' })

        await user.tab()
        expect(confirm).toHaveFocus()
        await user.tab()
        expect(cancel).toHaveFocus()
        await user.tab({ shift: true })
        expect(confirm).toHaveFocus()
    })

    it('closes on Escape and gives focus back to what opened it', async () => {
        render(() => <Harness />)
        const user = userEvent.setup()
        const opener = screen.getByRole('button', { name: 'Open' })
        await user.click(opener)

        await user.keyboard('{Escape}')

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(opener).toHaveFocus()
    })

    it('closes on a click on the backdrop, not on a click inside', async () => {
        render(() => <Harness />)
        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: 'Open' }))
        const dialog = screen.getByRole('dialog')

        await user.click(screen.getByText('2 tickets move to To Do.'))
        expect(dialog).toBeInTheDocument()

        await user.click(dialog.parentElement!)
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('does not confirm while the confirm is disabled', async () => {
        const onConfirm = vi.fn()
        render(() => <Harness onConfirm={onConfirm} withField confirmDisabled />)
        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: 'Open' }))

        expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
        await user.keyboard('{Enter}')

        expect(onConfirm).not.toHaveBeenCalled()
    })
})
