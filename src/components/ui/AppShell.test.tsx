import { render, screen, waitFor } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppShell } from './AppShell'

function screenIs(narrow: boolean) {
    vi.stubGlobal(
        'matchMedia',
        vi.fn().mockImplementation((query: string) => ({
            matches: narrow,
            media: query,
            addEventListener: () => {},
            removeEventListener: () => {},
        })),
    )
}

const nav = () => (
    <nav aria-label="Main">
        <a href="/epics">Epics</a>
        <button type="button">New epic</button>
    </nav>
)

function shell() {
    return (
        <AppShell nav={nav()} title="Tickets" status={<span role="status">Live</span>} route="/">
            <p>Page content</p>
        </AppShell>
    )
}

afterEach(() => vi.unstubAllGlobals())

describe('AppShell on a phone', () => {
    it('puts a Search button in the top bar that calls back with the button', async () => {
        screenIs(true)
        const onSearch = vi.fn()
        render(() => (
            <AppShell nav={nav()} title="Tickets" route="/" onSearch={onSearch}>
                <p>Page content</p>
            </AppShell>
        ))
        const button = screen.getByRole('button', { name: 'Search' })
        await userEvent.click(button)
        expect(onSearch).toHaveBeenCalledWith(button)
    })

    it('shows the content and a top bar, with the drawer shut and out of reach', () => {
        screenIs(true)
        render(() => shell())

        expect(screen.getByText('Page content')).toBeVisible()
        expect(screen.getByText('Tickets')).toBeInTheDocument()
        expect(screen.getByRole('status')).toHaveTextContent('Live')
        const menu = screen.getByRole('button', { name: 'Menu' })
        expect(menu).toHaveAttribute('aria-expanded', 'false')
        expect(document.getElementById(menu.getAttribute('aria-controls')!)).toHaveAttribute('inert')
        expect(screen.getByRole('link', { name: 'Epics', hidden: true }).closest('[inert]')).not.toBeNull()
    })

    it('opens with focus inside, hides the content behind, and closes on the menu button', async () => {
        screenIs(true)
        const user = userEvent.setup()
        render(() => shell())
        const menu = screen.getByRole('button', { name: 'Menu' })

        await user.click(menu)
        expect(menu).toHaveAttribute('aria-expanded', 'true')
        await waitFor(() => expect(screen.getByRole('link', { name: 'Epics' })).toHaveFocus())
        expect(screen.getByText('Page content').closest('.app-shell__column')).toHaveAttribute('inert')

        await user.click(menu)
        expect(menu).toHaveAttribute('aria-expanded', 'false')
        expect(menu).toHaveFocus()
        expect(screen.getByText('Page content').closest('.app-shell__column')).not.toHaveAttribute('inert')
    })

    it('closes on Escape and returns focus to the menu button', async () => {
        screenIs(true)
        const user = userEvent.setup()
        render(() => shell())
        await user.click(screen.getByRole('button', { name: 'Menu' }))

        await user.keyboard('{Escape}')

        expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false')
        expect(screen.getByRole('button', { name: 'Menu' })).toHaveFocus()
    })

    it('closes on a tap outside, and on choosing a link', async () => {
        screenIs(true)
        const user = userEvent.setup()
        render(() => shell())
        const menu = screen.getByRole('button', { name: 'Menu' })

        await user.click(menu)
        await user.click(document.querySelector('.app-shell__scrim')!)
        expect(menu).toHaveAttribute('aria-expanded', 'false')

        await user.click(menu)
        await user.click(screen.getByRole('link', { name: 'Epics' }))
        expect(menu).toHaveAttribute('aria-expanded', 'false')
    })

    it('closes when the route changes', async () => {
        screenIs(true)
        const user = userEvent.setup()
        const [route, setRoute] = createSignal('/')
        render(() => (
            <AppShell nav={nav()} title="Tickets" route={route()}>
                <p>Page content</p>
            </AppShell>
        ))
        await user.click(screen.getByRole('button', { name: 'Menu' }))

        setRoute('/epics')

        await waitFor(() => expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false'))
    })

    it('keeps every nav control in the drawer', async () => {
        screenIs(true)
        render(() => shell())

        const drawer = document.querySelector('.app-shell__drawer')!
        expect(drawer).toContainElement(screen.getByRole('button', { name: 'New epic', hidden: true }))
        expect(drawer).toContainElement(screen.getByRole('link', { name: 'Epics', hidden: true }))
    })
})

describe('AppShell on a wide screen', () => {
    it('is the rail beside the content, with no top bar or drawer', () => {
        screenIs(false)
        render(() => shell())

        expect(screen.queryByRole('button', { name: 'Menu' })).not.toBeInTheDocument()
        expect(document.querySelector('.app-shell__drawer')).toBeNull()
        expect(screen.getByRole('link', { name: 'Epics' })).toBeVisible()
    })
})
