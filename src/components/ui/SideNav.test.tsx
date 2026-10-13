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

    describe('loading', () => {
        const links = [
            { label: 'Tickets', href: '/' },
            { label: 'Docs', href: '/docs' },
        ]

        it('draws a monogram circle, a name bar and one row per link, with no real content', () => {
            const { container } = render(() => (
                <SideNav links={links} userName="Ada Lovelace" onLogout={() => {}} loading />
            ))
            const rail = container.querySelector('aside') as HTMLElement

            expect(rail).toHaveAttribute('aria-busy', 'true')
            expect(rail.querySelectorAll('.side-nav__profile .skeleton--circle')).toHaveLength(1)
            expect(rail.querySelectorAll('.side-nav__profile .skeleton--line')).toHaveLength(1)
            expect(rail.querySelectorAll('.side-nav__list li')).toHaveLength(links.length)
            expect(rail.querySelectorAll('.side-nav__list .skeleton--circle')).toHaveLength(2)

            // None of the real content, even though it was passed in.
            expect(screen.queryByRole('link')).not.toBeInTheDocument()
            expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument()
            expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument()
            expect(screen.queryByText('Tickets')).not.toBeInTheDocument()
        })

        it('has exactly one status message, and leaves the caller\'s status slot out', () => {
            render(() => (
                <SideNav
                    links={links}
                    status={<p role="status">Live</p>}
                    onLogout={() => {}}
                    loading
                />
            ))

            expect(screen.getAllByRole('status')).toHaveLength(1)
            expect(screen.getByRole('status')).toHaveTextContent('Loading navigation…')
            expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
        })

        it('is the same rail as the loaded one: same sections, same rows for the links', () => {
            const { container } = render(() => (
                <>
                    <div data-testid="a">
                        <SideNav links={links} onLogout={() => {}} loading />
                    </div>
                    <div data-testid="b">
                        <SideNav links={links} userName="Ada Lovelace" onLogout={() => {}} />
                    </div>
                </>
            ))
            const [loading, loaded] = Array.from(container.querySelectorAll('aside'))
            const sections = (rail: Element) =>
                Array.from(rail.children)
                    .map((child) => child.className.split(' ')[0] || child.tagName)
                    .filter((name) => name !== 'visually-hidden')

            expect(loading.className).toBe(loaded.className)
            expect(sections(loading)).toEqual(sections(loaded))
            expect(loading.querySelectorAll('.side-nav__list li')).toHaveLength(
                loaded.querySelectorAll('.side-nav__list li').length,
            )
            // Each placeholder row wears the link's own class, so it is the
            // link's own height.
            for (const row of Array.from(loading.querySelectorAll('.side-nav__list li > *'))) {
                expect(row).toHaveClass('side-nav__link')
            }
        })
    })
})
