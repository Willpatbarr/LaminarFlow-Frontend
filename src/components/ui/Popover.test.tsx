import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Popover } from './Popover'

function Harness(props: { name: string; role?: 'dialog' | 'menu'; onPick?: () => void }) {
    return (
        <Popover
            label={props.name}
            role={props.role}
            trigger={(trigger) => (
                <button type="button" {...trigger}>
                    Open {props.name}
                </button>
            )}
        >
            {props.role === 'menu' ? (
                <>
                    <button type="button" role="menuitem" onClick={props.onPick}>
                        One
                    </button>
                    <button type="button" role="menuitem">
                        Two
                    </button>
                    <button type="button" role="menuitem">
                        Three
                    </button>
                </>
            ) : (
                <>
                    <input aria-label="Field" />
                    <button type="button" data-popover-close>
                        Done
                    </button>
                </>
            )}
        </Popover>
    )
}

describe('Popover', () => {
    it('opens in a portal, moves focus in, and wires the trigger', async () => {
        const user = userEvent.setup()
        const { container } = render(() => <Harness name="A" />)
        const trigger = screen.getByRole('button', { name: 'Open A' })
        expect(trigger).toHaveAttribute('aria-expanded', 'false')
        expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
        await user.click(trigger)
        const panel = screen.getByRole('dialog', { name: 'A' })
        expect(container.contains(panel)).toBe(false)
        expect(trigger).toHaveAttribute('aria-expanded', 'true')
        expect(trigger).toHaveAttribute('aria-controls', panel.id)
        expect(screen.getByLabelText('Field')).toHaveFocus()
    })

    it('closes on Escape and returns focus to the trigger', async () => {
        const user = userEvent.setup()
        render(() => <Harness name="A" />)
        const trigger = screen.getByRole('button', { name: 'Open A' })
        await user.click(trigger)
        await user.keyboard('{Escape}')
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(trigger).toHaveFocus()
        expect(trigger).toHaveAttribute('aria-expanded', 'false')
    })

    it('closes on a press outside, and leaves focus where the press landed', async () => {
        const user = userEvent.setup()
        render(() => (
            <>
                <Harness name="A" />
                <button type="button">Elsewhere</button>
            </>
        ))
        await user.click(screen.getByRole('button', { name: 'Open A' }))
        const other = screen.getByRole('button', { name: 'Elsewhere' })
        await user.click(other)
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(other).toHaveFocus()
    })

    it('a press inside does not close it; the trigger toggles it', async () => {
        const user = userEvent.setup()
        render(() => <Harness name="A" />)
        const trigger = screen.getByRole('button', { name: 'Open A' })
        await user.click(trigger)
        await user.click(screen.getByLabelText('Field'))
        expect(screen.getByRole('dialog')).toBeInTheDocument()
        await user.click(trigger)
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('an element marked data-popover-close closes it and focus returns', async () => {
        const user = userEvent.setup()
        render(() => <Harness name="A" />)
        const trigger = screen.getByRole('button', { name: 'Open A' })
        await user.click(trigger)
        await user.click(screen.getByRole('button', { name: 'Done' }))
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(trigger).toHaveFocus()
    })

    it('only one is open at a time', async () => {
        const user = userEvent.setup()
        render(() => (
            <>
                <Harness name="A" />
                <Harness name="B" />
            </>
        ))
        await user.click(screen.getByRole('button', { name: 'Open A' }))
        expect(screen.getByRole('dialog', { name: 'A' })).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Open B' }))
        expect(screen.queryByRole('dialog', { name: 'A' })).not.toBeInTheDocument()
        expect(screen.getByRole('dialog', { name: 'B' })).toBeInTheDocument()
        expect(screen.getAllByRole('dialog')).toHaveLength(1)
    })

    it('as a menu: arrow keys move between items, selecting closes, focus returns', async () => {
        const user = userEvent.setup()
        const picked = vi.fn()
        render(() => <Harness name="M" role="menu" onPick={picked} />)
        const trigger = screen.getByRole('button', { name: 'Open M' })
        expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
        await user.click(trigger)
        expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus()
        await user.keyboard('{ArrowDown}')
        expect(screen.getByRole('menuitem', { name: 'Two' })).toHaveFocus()
        await user.keyboard('{End}')
        expect(screen.getByRole('menuitem', { name: 'Three' })).toHaveFocus()
        await user.keyboard('{ArrowDown}')
        expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus()
        await user.keyboard('{ArrowUp}')
        expect(screen.getByRole('menuitem', { name: 'Three' })).toHaveFocus()
        await user.keyboard('{Home}{Enter}')
        expect(picked).toHaveBeenCalledOnce()
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
        expect(trigger).toHaveFocus()
    })

    it('as a listbox: opens at a caret rect without taking focus, and a press inside keeps focus in the field', async () => {
        const onOpenChange = vi.fn()
        render(() => (
            <>
                <input aria-label="Field" />
                <Popover open onOpenChange={onOpenChange} role="listbox" label="Links" id="links" align="start" anchor={() => new DOMRect(40, 20, 0, 16)}>
                    <div role="option" aria-selected="true">One</div>
                </Popover>
            </>
        ))
        const field = screen.getByLabelText('Field')
        field.focus()
        const panel = screen.getByRole('listbox', { name: 'Links' })
        expect(panel).toHaveAttribute('id', 'links')
        expect(panel).not.toHaveAttribute('tabindex')
        expect(field).toHaveFocus()
        expect(panel).toHaveAttribute('data-placement')
        const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
        screen.getByRole('option').dispatchEvent(press)
        expect(press.defaultPrevented).toBe(true)
        expect(onOpenChange).not.toHaveBeenCalled()
    })
})
