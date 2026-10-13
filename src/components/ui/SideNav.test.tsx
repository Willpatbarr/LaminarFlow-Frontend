import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { monogram, SideNav } from './SideNav'

describe('monogram', () => {
    it.each([
        ['Ada Lovelace', 'AL'],
        ['ada lovelace', 'AL'],
        ['Ada', 'A'],
        ['Ada Augusta King', 'AK'],
        ['  Ada   Lovelace  ', 'AL'],
        ['', ''],
    ])('%j is %j', (name, expected) => {
        expect(monogram(name)).toBe(expected)
    })
})

describe('SideNav', () => {
    it('lists the links it is given and offers logout once a user is known', async () => {
        const onLogout = vi.fn()
        render(() => (
            <SideNav links={[{ label: 'Tickets', href: '/' }]} userName="Ada Lovelace" onLogout={onLogout} />
        ))

        expect(screen.getByRole('link', { name: 'Tickets' })).toHaveAttribute('href', '/')
        expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()

        await userEvent.setup().click(screen.getByRole('button', { name: 'Log out' }))
        expect(onLogout).toHaveBeenCalledOnce()
    })

    it('has no logout control while there is no user', () => {
        render(() => <SideNav links={[{ label: 'Tickets', href: '/' }]} onLogout={() => {}} />)

        expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument()
    })
})
