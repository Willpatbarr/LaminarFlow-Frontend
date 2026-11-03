import { screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { connectSyncToSession, wipeLocalData } from '@/sync'
import { listRoutes, ticket } from '@/sync/testing/harness'
import { openApp, startAnonymous } from '@/testing/app'
import { ok } from '@/testing/fetch'

// The Settings page, the sidebar's Settings button and the account menu (LAM-200),
// through the real route tree; only `fetch` is stubbed.

let disconnect = () => {}

beforeEach(async () => {
    await startAnonymous()
    disconnect = connectSyncToSession()
})
afterEach(async () => {
    disconnect()
    await wipeLocalData()
    vi.unstubAllGlobals()
})

const user = () => userEvent.setup()

const open = (url: string) => openApp(url, {
    ...listRoutes([ticket()]),
    'POST /api/v1/auth/logout': () => ok({}),
    'POST /api/v1/auth/tokens/list': () => ok({ items: [], next_cursor: null }),
})

describe('the Settings page', () => {
    it('has a section for the account, appearance, teams, API tokens and log out', async () => {
        await open('/settings')
        await screen.findByRole('heading', { name: 'Settings', level: 1 })
        for (const name of ['Account', 'Appearance', 'Teams', 'API tokens', 'Log out']) {
            expect(screen.getByRole('heading', { name, level: 2 })).toBeInTheDocument()
        }
        const account = screen.getByRole('region', { name: 'Account' })
        expect(within(account).getByText('ada@example.com')).toBeInTheDocument()
        expect(within(account).getByText('Ada Lovelace')).toBeInTheDocument()
        expect(within(account).getByText(/not available yet/)).toBeInTheDocument()
        expect(within(account).queryByRole('textbox')).toBeNull()
        expect(within(screen.getByRole('region', { name: 'Appearance' })).getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument()
    })

    it('links each team to its settings and aspect types, and to the tokens page', async () => {
        await open('/settings')
        const teams = await screen.findByRole('region', { name: 'Teams' })
        const settings = await within(teams).findByRole('link', { name: 'Team settings for Core' })
        expect(settings).toHaveAttribute('href', expect.stringMatching(/^\/teams\/[^/]+\/settings$/))
        expect(within(teams).getByRole('link', { name: 'Aspect types for Core' })).toHaveAttribute(
            'href',
            expect.stringMatching(/^\/teams\/[^/]+\/aspect-types$/),
        )
        expect(screen.getByRole('link', { name: 'Manage API tokens' })).toHaveAttribute('href', '/settings/tokens')
    })

    it('logs out from the bottom section', async () => {
        const history = await open('/settings')
        // The rail has a Log out button too; this is the one in the page's own section.
        const section = await screen.findByRole('region', { name: 'Log out' })
        await user().click(within(section).getByRole('button', { name: 'Log out' }))
        await waitFor(() => expect(history.get()).toBe('/login'))
    })
})

describe('the Settings button', () => {
    it('is in the rail with its key, marks the page it is on, and API tokens is not in the main nav', async () => {
        await open('/')
        const main = await screen.findByRole('navigation', { name: 'Main' })
        expect(within(main).queryByRole('link', { name: 'API tokens' })).toBeNull()
        const button = screen.getByRole('link', { name: 'Settings' })
        expect(button).toHaveAttribute('href', '/settings')
        expect(button).toHaveTextContent('G then S')
        expect(button).not.toHaveAttribute('aria-current')
        await user().click(button)
        await waitFor(() => expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page'))
        await user().click(await screen.findByRole('link', { name: 'Manage API tokens' }))
        await screen.findByRole('heading', { name: 'API tokens', level: 1 })
        await waitFor(() => expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('data-active'))
    })

    it('G then S goes to settings', async () => {
        const history = await open('/')
        await screen.findByRole('link', { name: 'Settings' })
        await user().keyboard('gs')
        await waitFor(() => expect(history.get()).toBe('/settings'))
    })
})

describe('the account menu', () => {
    it('opens from the profile, lists its items, and Settings goes to /settings', async () => {
        const history = await open('/')
        const trigger = await screen.findByRole('button', { name: 'Account menu' })
        expect(trigger).toHaveAttribute('aria-expanded', 'false')
        await user().click(trigger)
        const menu = screen.getByRole('menu', { name: 'Account menu' })
        expect(trigger).toHaveAttribute('aria-expanded', 'true')
        const settings = within(menu).getByRole('menuitem', { name: /^Settings/ })
        expect(settings).toHaveTextContent('G then S')
        expect(within(menu).getByRole('menuitem', { name: 'API tokens' })).toHaveAttribute('href', '/settings/tokens')
        expect(within(menu).getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual(['Light', 'Dark', 'System'])
        expect(within(menu).getByRole('menuitem', { name: 'Log out' })).toBeInTheDocument()
        await user().click(settings)
        await waitFor(() => expect(history.get()).toBe('/settings'))
        expect(screen.queryByRole('menu')).toBeNull()
    })

    it('moves with the arrow keys, and Esc closes it and returns focus to the profile', async () => {
        await open('/')
        const trigger = await screen.findByRole('button', { name: 'Account menu' })
        await user().click(trigger)
        const menu = screen.getByRole('menu', { name: 'Account menu' })
        const items = [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')]
        expect(items[0]).toHaveFocus()
        await user().keyboard('{ArrowDown}')
        expect(items[1]).toHaveFocus()
        await user().keyboard('{ArrowUp}{ArrowUp}')
        expect(items[items.length - 1]).toHaveFocus()
        await user().keyboard('{Escape}')
        expect(screen.queryByRole('menu')).toBeNull()
        expect(trigger).toHaveFocus()
    })

    it('Log out in the menu logs out', async () => {
        const history = await open('/')
        await user().click(await screen.findByRole('button', { name: 'Account menu' }))
        await user().click(screen.getByRole('menuitem', { name: 'Log out' }))
        await waitFor(() => expect(history.get()).toBe('/login'))
    })
})
