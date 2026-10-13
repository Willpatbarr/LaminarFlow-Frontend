import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { PendingIndicator } from './PendingIndicator'

const items = [
    { id: 'a', href: '/tickets/a', label: 'First', detail: 'Waiting to sync' },
    { id: 'b', label: 'Second', detail: 'Needs attention', action: { label: 'Discard my change', onClick: () => {} } },
]

describe('PendingIndicator', () => {
    it('is a collapsed disclosure showing the summary', () => {
        render(() => <PendingIndicator label="2 changes waiting" tone="waiting" items={items} />)

        const button = screen.getByRole('button', { name: '2 changes waiting' })
        expect(button).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByRole('list')).not.toBeInTheDocument()
    })

    it('lists the items with links on opening, and closes on Escape with focus back on the button', async () => {
        render(() => <PendingIndicator label="2 changes waiting" tone="waiting" items={items} />)
        const user = userEvent.setup()
        const button = screen.getByRole('button', { name: '2 changes waiting' })

        await user.click(button)

        expect(button).toHaveAttribute('aria-expanded', 'true')
        const list = screen.getByRole('list', { name: 'Changes not synced yet' })
        expect(within(list).getByRole('link', { name: 'First' })).toHaveAttribute('href', '/tickets/a')
        expect(within(list).getByText('Second')).toBeInTheDocument()
        expect(within(list).queryByRole('link', { name: 'Second' })).not.toBeInTheDocument()

        await user.click(within(list).getByRole('button', { name: 'Discard my change' }))
        await user.keyboard('{Escape}')
        expect(screen.queryByRole('list')).not.toBeInTheDocument()
        expect(button).toHaveFocus()
    })

    it('runs an item action', async () => {
        const onClick = vi.fn()
        render(() => (
            <PendingIndicator
                label="1 change needs attention"
                tone="attention"
                items={[{ id: 'x', label: 'Gone', detail: 'Refused', action: { label: 'Discard my change', onClick } }]}
            />
        ))
        const user = userEvent.setup()

        await user.click(screen.getByRole('button', { name: '1 change needs attention' }))
        await user.click(screen.getByRole('button', { name: 'Discard my change' }))

        expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('marks the tone on the indicator, so a decision can look different from a fault', () => {
        render(() => <PendingIndicator label="1 change needs a decision" tone="decision" items={items} />)

        expect(screen.getByRole('button', { name: '1 change needs a decision' }).parentElement).toHaveAttribute(
            'data-tone',
            'decision',
        )
    })
})
