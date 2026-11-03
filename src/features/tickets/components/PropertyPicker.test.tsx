import { cleanup, render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PropertyPicker } from './PropertyPicker'

afterEach(cleanup)

const OPTIONS = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
]

function setup(extra: Partial<Parameters<typeof PropertyPicker>[0]> = {}) {
    const onChange = vi.fn()
    render(() => <PropertyPicker label="Epic" value="" noneLabel="None" options={OPTIONS} onChange={onChange} {...extra} />)
    return { onChange, user: userEvent.setup() }
}

describe('PropertyPicker', () => {
    it('reads as one button named for the property and its value', () => {
        setup({ value: 'b' })
        expect(screen.getByRole('button', { name: 'Epic: Beta' })).toBeInTheDocument()
    })

    it('opens a list with a search box in focus, filters it, and picks with Enter', async () => {
        const { onChange, user } = setup()
        await user.click(screen.getByRole('button', { name: 'Epic: None' }))
        const search = await screen.findByRole('searchbox', { name: 'Search epic' })
        await vi.waitFor(() => expect(search).toHaveFocus())

        await user.type(search, 'bet')
        const list = screen.getByRole('listbox', { name: 'Epic' })
        expect(within(list).getAllByRole('option').map((option) => option.textContent)).toEqual(['Beta'])

        await user.keyboard('{Enter}')
        expect(onChange).toHaveBeenCalledWith('b')
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('says so when nothing matches, and Escape closes it', async () => {
        const { user } = setup()
        await user.click(screen.getByRole('button', { name: 'Epic: None' }))
        await user.type(await screen.findByRole('searchbox'), 'zzz')
        expect(screen.getByText('No matches')).toBeInTheDocument()
        await user.keyboard('{Escape}')
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('offers "Create new…" inside the list and closes it', async () => {
        const onCreate = vi.fn()
        const { user } = setup({ create: { label: 'Create new epic…', onCreate } })
        await user.click(screen.getByRole('button', { name: 'Epic: None' }))
        await user.click(await screen.findByRole('button', { name: 'Create new epic…' }))
        expect(onCreate).toHaveBeenCalledOnce()
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('is not openable while disabled, and shows its error', () => {
        setup({ disabled: true, error: 'That epic is gone.' })
        expect(screen.getByRole('button', { name: 'Epic: None' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Epic: None' })).toHaveAccessibleDescription('That epic is gone.')
    })
})
