import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ICON_PATHS } from './icons/Icon'
import { initialsOf, monogram, SideNav } from './SideNav'

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

describe('initialsOf', () => {
    it.each([
        ['Bugs', 'BU'],
        ['Q', 'Q'],
        ['Release blockers', 'RB'],
        ['  my  open items ', 'MO'],
        ['', ''],
    ])('%j is %j', (name, expected) => {
        expect(initialsOf(name)).toBe(expected)
    })
})

describe('SideNav', () => {
    it('has a Search button with the shortcut beside it that calls back with the button', async () => {
        const onClick = vi.fn()
        render(() => (
            <SideNav
                links={[{ label: 'Tickets', href: '/' }]}
                search={{ onClick, hint: '⌘K' }}
                userName="Ada Lovelace"
                onLogout={() => {}}
            />
        ))
        const button = screen.getByRole('button', { name: /^Search/ })
        expect(button).toHaveTextContent('⌘K')
        await userEvent.click(button)
        expect(onClick).toHaveBeenCalledWith(button)
    })

    it('has no Search button unless it is given one', () => {
        render(() => <SideNav links={[{ label: 'Tickets', href: '/' }]} userName="Ada" onLogout={() => {}} />)
        expect(screen.queryByRole('button', { name: /^Search/ })).toBeNull()
    })

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

    it('offers a team switcher and the projects, and collapse keeps every label', async () => {
        const onChange = vi.fn()
        render(() => (
            <SideNav
                links={[{ label: 'Tickets', href: '/' }]}
                teams={{ options: [{ value: 't1', label: 'Core' }, { value: 't2', label: 'Ops' }], value: 't1', onChange }}
                projects={[{ label: 'Alpha', href: '/projects/p1' }]}
                userName="Ada Lovelace"
                onLogout={() => {}}
            />
        ))
        const user = userEvent.setup()

        await user.selectOptions(screen.getByLabelText('Team'), 't2')
        expect(onChange).toHaveBeenCalledWith('t2')
        expect(screen.getByRole('link', { name: 'Alpha' })).toHaveAttribute('href', '/projects/p1')

        await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
        expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false')
        expect(screen.getByRole('link', { name: 'Tickets' })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Alpha' })).toBeInTheDocument()
        expect(screen.getByLabelText('Team')).toBeInTheDocument()
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

    it('lists the saved views under their own heading, notes a private one, and says when there are none', () => {
        const views = [
            { label: 'Bugs', href: '/views/v1' },
            { label: 'Mine', href: '/views/v2', note: 'Private' },
        ]
        const { unmount } = render(() => (
            <SideNav links={[{ label: 'Tickets', href: '/' }]} views={views} userName="Ada" onLogout={() => {}} />
        ))

        expect(screen.getByRole('heading', { name: 'Saved views' })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Bugs' })).toHaveAttribute('href', '/views/v1')
        expect(screen.getByRole('link', { name: 'Mine Private' })).toHaveAttribute('href', '/views/v2')
        unmount()

        render(() => <SideNav links={[]} views={[]} userName="Ada" onLogout={() => {}} />)
        expect(screen.getByText('No saved views yet')).toBeInTheDocument()
    })

    it('has no saved views section when the caller gives none', () => {
        render(() => <SideNav links={[]} userName="Ada" onLogout={() => {}} />)

        expect(screen.queryByRole('heading', { name: 'Saved views' })).not.toBeInTheDocument()
    })
    describe('collapsed', () => {
        const rail = () => (
            <SideNav
                links={[{ label: 'Tickets', href: '/' }]}
                teams={{ options: [{ value: 't1', label: 'Quality' }, { value: 't2', label: 'Ops' }], value: 't1', onChange: () => {} }}
                projects={[{ label: 'Alpha', href: '/projects/p1' }]}
                views={[
                    { label: 'Bugs', href: '/views/v1' },
                    { label: 'Mine', href: '/views/v2' },
                ]}
                create={[
                    { label: 'New epic', onClick: () => {}, icon: 'epic' },
                    { label: 'New sprint', onClick: () => {}, icon: 'sprint' },
                    { label: 'New milestone', onClick: () => {}, icon: 'milestone' },
                ]}
                userName="Ada Lovelace"
                onLogout={() => {}}
            />
        )

        it('gives each create action its own icon, and keeps its name', async () => {
            const { container } = render(rail)
            await userEvent.setup().click(screen.getByRole('button', { name: 'Collapse sidebar' }))

            const create = screen.getByRole('list', { name: 'Create' })
            const paths = Array.from(create.querySelectorAll('svg g path')).map((p) => p.getAttribute('d'))
            expect(paths).toEqual([ICON_PATHS.epic, ICON_PATHS.sprint, ICON_PATHS.milestone])
            for (const name of ['New epic', 'New sprint', 'New milestone']) {
                expect(screen.getByRole('button', { name })).toHaveAttribute('title', name)
            }
            expect(container.textContent).not.toContain('+')
        })

        it('shows initials for projects and saved views only while collapsed', async () => {
            const { container } = render(rail)
            const user = userEvent.setup()
            expect(container.querySelector('.side-nav__initials')).toBeNull()

            await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
            const initials = Array.from(container.querySelectorAll('.side-nav__initials')).map((e) => e.textContent)
            expect(initials).toEqual(['AL', 'BU', 'MI'])
            expect(screen.getByRole('link', { name: 'Bugs' })).toHaveAttribute('title', 'Bugs')

            await user.click(screen.getByRole('button', { name: 'Expand sidebar' }))
            expect(container.querySelector('.side-nav__initials')).toBeNull()
        })

        it('replaces "Q ▾" with the team avatar, over a select that still works', async () => {
            render(rail)
            await userEvent.setup().click(screen.getByRole('button', { name: 'Collapse sidebar' }))

            expect(document.querySelector('.side-nav__team-avatar')).toHaveTextContent('QU')
            expect(screen.getByLabelText('Team')).toHaveValue('t1')
        })

        it('turns Log out into an icon button that keeps its name and a tooltip', async () => {
            render(rail)
            const logout = screen.getByRole('button', { name: 'Log out' })
            expect(logout).not.toHaveAttribute('title')

            await userEvent.setup().click(screen.getByRole('button', { name: 'Collapse sidebar' }))
            expect(logout).toHaveAccessibleName('Log out')
            expect(logout).toHaveAttribute('title', 'Log out')
            expect(logout.querySelector('svg')).not.toBeNull()
        })

        it('has a divider before each section', () => {
            const { container } = render(rail)
            // Projects, Create, Saved views, the foot, and the one under the team picker.
            expect(container.querySelectorAll('hr.side-nav__divider')).toHaveLength(5)
        })
    })
})
