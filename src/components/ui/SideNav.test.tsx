import { render, screen, waitFor } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ICON_PATHS } from './icons/Icon'
import { initialsOf, monogram, SideNav } from './SideNav'
import { createSignal } from 'solid-js'

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
    beforeEach(() => localStorage.clear())

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

    it('lists the saved views under their own heading, names each one by scope, and says when there are none', () => {
        const views = [
            { label: 'Bugs', href: '/views/v1', scope: 'team' as const },
            { label: 'Mine', href: '/views/v2', scope: 'private' as const },
        ]
        const { unmount } = render(() => (
            <SideNav links={[{ label: 'Tickets', href: '/' }]} views={views} userName="Ada" onLogout={() => {}} />
        ))

        expect(screen.getByRole('heading', { name: 'Saved views' })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Bugs, team view' })).toHaveAttribute('href', '/views/v1')
        expect(screen.getByRole('link', { name: 'Mine, private view' })).toHaveAttribute('href', '/views/v2')
        unmount()

        render(() => <SideNav links={[]} views={[]} userName="Ada" onLogout={() => {}} />)
        expect(screen.getByText('No saved views yet')).toBeInTheDocument()
    })

    it('puts a lock on private saved views only, and the scope in the name and the rail tooltip', async () => {
        const views = [
            { label: 'By assignee', href: '/views/v1', scope: 'team' as const },
            { label: 'My bugs', href: '/views/v2', scope: 'private' as const },
        ]
        const { container } = render(() => <SideNav links={[]} views={views} userName="Ada" onLogout={() => {}} />)
        const team = screen.getByRole('link', { name: 'By assignee, team view' })
        const mine = screen.getByRole('link', { name: 'My bugs, private view' })
        expect(team.querySelector('.side-nav__scope')).toBeNull()
        expect(mine.querySelector('.side-nav__scope path')).toHaveAttribute('d', ICON_PATHS.key)
        expect(mine).not.toHaveAttribute('data-tip')

        await userEvent.setup().click(screen.getByRole('button', { name: 'Collapse sidebar' }))
        expect(container.querySelector('.side-nav--collapsed')).not.toBeNull()
        expect(team).toHaveAttribute('data-tip', 'By assignee, team view')
        expect(mine).toHaveAttribute('data-tip', 'My bugs, private view')
        expect(mine.querySelector('.side-nav__scope')).not.toBeNull()
    })

    it('has no saved views section when the caller gives none', () => {
        render(() => <SideNav links={[]} userName="Ada" onLogout={() => {}} />)

        expect(screen.queryByRole('heading', { name: 'Saved views' })).not.toBeInTheDocument()
    })
    describe('a create action that cannot be used (LAM-199)', () => {
        it('stays in the list, disabled, and says why', async () => {
            const onClick = vi.fn()
            render(() => (
                <SideNav
                    links={[{ label: 'Tickets', href: '/' }]}
                    create={[{ label: 'New team', icon: 'team', onClick, disabledReason: 'Needs a connection.' }]}
                    userName="Ada"
                    onLogout={() => {}}
                />
            ))
            const button = screen.getByRole('button', { name: 'New team' })
            expect(button).toBeDisabled()
            expect(button).toHaveAccessibleDescription('Needs a connection.')
            // Written under the list too, so a touch screen can read it.
            expect(screen.getAllByText('Needs a connection.').length).toBeGreaterThan(1)
            await userEvent.setup().click(button)
            expect(onClick).not.toHaveBeenCalled()
        })
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
                expect(screen.getByRole('button', { name })).toHaveAttribute('data-tip', name)
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
            expect(screen.getByRole('link', { name: 'Bugs' })).toHaveAttribute('data-tip', 'Bugs')

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
            expect(logout).not.toHaveAttribute('data-tip')

            await userEvent.setup().click(screen.getByRole('button', { name: 'Collapse sidebar' }))
            expect(logout).toHaveAccessibleName('Log out')
            expect(logout).toHaveAttribute('data-tip', 'Log out')
            expect(logout.querySelector('svg')).not.toBeNull()
        })

        it('has a divider before each section', () => {
            const { container } = render(rail)
            // Projects, Create, Saved views, the foot, and the one under the team picker.
            expect(container.querySelectorAll('hr.side-nav__divider')).toHaveLength(5)
        })
    })
})

// A screen of the given kind: 'tablet' is 768-1024px, 'phone' under 768, else a desktop.
function screenIs(kind: 'phone' | 'tablet' | 'desktop') {
    vi.stubGlobal(
        'matchMedia',
        vi.fn().mockImplementation((query: string) => ({
            matches: kind === 'phone' ? query.includes('max-width: 767px') : kind === 'tablet' && query.includes('min-width: 768px'),
            media: query,
            addEventListener: () => {},
            removeEventListener: () => {},
        })),
    )
}

describe('SideNav default width (LAM-185)', () => {
    beforeEach(() => localStorage.clear())
    afterEach(() => vi.unstubAllGlobals())

    const nav = () => <SideNav links={[{ label: 'Tickets', href: '/' }]} userName="Ada Lovelace" onLogout={() => {}} />

    it('starts as the rail on a tablet, every link still there, and can be expanded', async () => {
        screenIs('tablet')
        const { container } = render(nav)
        expect(container.querySelector('.side-nav--collapsed')).not.toBeNull()
        expect(screen.getByRole('link', { name: 'Tickets' })).toBeTruthy()
        await userEvent.setup().click(screen.getByRole('button', { name: 'Expand sidebar' }))
        expect(container.querySelector('.side-nav--collapsed')).toBeNull()
    })

    it('starts expanded on a desktop', () => {
        screenIs('desktop')
        const { container } = render(nav)
        expect(container.querySelector('.side-nav--collapsed')).toBeNull()
    })

    it('remembers an explicit choice, which beats the tablet default', async () => {
        screenIs('tablet')
        const first = render(nav)
        await userEvent.setup().click(screen.getByRole('button', { name: 'Expand sidebar' }))
        first.unmount()
        const second = render(nav)
        expect(second.container.querySelector('.side-nav--collapsed')).toBeNull()
    })

    it('keeps a stored collapse on a desktop, and never collapses inside the phone drawer', () => {
        localStorage.setItem('lf-side-nav-collapsed', '1')
        screenIs('desktop')
        const desktop = render(nav)
        expect(desktop.container.querySelector('.side-nav--collapsed')).not.toBeNull()
        desktop.unmount()
        screenIs('phone')
        const phone = render(nav)
        expect(phone.container.querySelector('.side-nav--collapsed')).toBeNull()
    })
})

// LAM-218 (P9): the names are explicit, not left to be worked out from the text inside, so they
// survive in both states and in tools that do not read through nested spans (LAM-161 regression).
describe('SideNav accessible names (LAM-218)', () => {
    beforeEach(() => localStorage.clear())
    afterEach(() => vi.unstubAllGlobals())

    const rail = () => (
        <SideNav
            links={[
                { label: 'Tickets', href: '/', hint: 'G T' },
                { label: 'Epics', href: '/epics', icon: 'epic' },
            ]}
            teams={{ options: [{ value: 't1', label: 'Quiet Team' }], value: 't1', onChange: () => {} }}
            projects={[{ label: 'Alpha', href: '/projects/p1' }]}
            views={[
                { label: 'Bugs', href: '/views/v1' },
                { label: 'Mine', href: '/views/v2', scope: 'private' as const },
            ]}
            create={[
                { label: 'New epic', icon: 'epic', onClick: () => {} },
                { label: 'New team', icon: 'team', onClick: () => {}, disabledReason: 'Needs a connection.' },
            ]}
            search={{ onClick: () => {}, hint: 'Ctrl K' }}
            help={{ onClick: () => {}, hint: '?' }}
            settings={{ href: '/settings', hint: 'G S' }}
            userName="Ada Lovelace"
            onLogout={() => {}}
        />
    )

    const expected: [string, string][] = [
        ['link', 'Tickets'],
        ['link', 'Epics'],
        ['link', 'Alpha'],
        ['link', 'Bugs'],
        ['link', 'Mine, private view'],
        ['link', 'Settings'],
        ['button', 'New epic'],
        ['button', 'New team'],
        ['button', 'Search'],
        ['button', 'Keyboard shortcuts'],
        ['button', 'Log out'],
    ]

    it.each(['expanded', 'collapsed'])('every link and button has an explicit name when %s', async (state) => {
        render(rail)
        if (state === 'collapsed') await userEvent.setup().click(screen.getByRole('button', { name: 'Collapse sidebar' }))
        for (const [role, name] of expected) {
            const el = screen.getByRole(role, { name })
            expect(el).toHaveAttribute('aria-label', name)
            expect(el).toHaveAccessibleName(name)
        }
    })
})

describe('SideNav tablet overlay (LAM-218)', () => {
    beforeEach(() => localStorage.clear())
    afterEach(() => vi.unstubAllGlobals())

    function Harness() {
        const [route, setRoute] = createSignal('/')
        return (
            <>
                <button type="button" onClick={() => setRoute('/elsewhere')}>
                    Go
                </button>
                <p>Outside</p>
                <SideNav
                    links={[{ label: 'Tickets', href: '/' }]}
                    settings={{ href: '/settings' }}
                    route={route()}
                    userName="Ada Lovelace"
                    onLogout={() => {}}
                />
            </>
        )
    }

    const open = async () => {
        screenIs('tablet')
        const view = render(() => <Harness />)
        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: 'Expand sidebar' }))
        expect(view.container.querySelector('.side-nav--collapsed')).toBeNull()
        return { ...view, user }
    }

    it('shuts when a link in it is followed, without storing a new choice', async () => {
        const { container, user } = await open()
        const link = screen.getByRole('link', { name: 'Settings' })
        link.addEventListener('click', (e) => e.preventDefault())
        await user.click(link)
        expect(container.querySelector('.side-nav--collapsed')).not.toBeNull()
        expect(localStorage.getItem('lf-side-nav-collapsed')).toBe('0')
    })

    it('shuts when the route changes', async () => {
        const { container, user } = await open()
        await user.click(screen.getByRole('button', { name: 'Go' }))
        expect(container.querySelector('.side-nav--collapsed')).not.toBeNull()
    })

    it('shuts on a press outside it, but not on one inside', async () => {
        const { container, user } = await open()
        await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }).closest('.side-nav__profile')!)
        expect(container.querySelector('.side-nav--collapsed')).toBeNull()
        await user.click(screen.getByText('Outside'))
        expect(container.querySelector('.side-nav--collapsed')).not.toBeNull()
    })

    it('shuts on Escape and puts focus on the button that reopens it', async () => {
        const { container, user } = await open()
        screen.getByRole('link', { name: 'Tickets' }).focus()
        await user.keyboard('{Escape}')
        expect(container.querySelector('.side-nav--collapsed')).not.toBeNull()
        expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveFocus()
        // And it can be opened again.
        await user.click(screen.getByRole('button', { name: 'Expand sidebar' }))
        expect(container.querySelector('.side-nav--collapsed')).toBeNull()
    })

    it('does nothing to a docked desktop sidebar', async () => {
        screenIs('desktop')
        const { container } = render(() => <Harness />)
        const user = userEvent.setup()
        await user.click(screen.getByText('Outside'))
        await user.keyboard('{Escape}')
        await user.click(screen.getByRole('button', { name: 'Go' }))
        expect(container.querySelector('.side-nav--collapsed')).toBeNull()
    })

    it('shows a tooltip with the name on hover and focus of a rail icon, and hides it on Escape', async () => {
        screenIs('tablet')
        render(() => <Harness />)
        const user = userEvent.setup()
        await user.hover(screen.getByRole('link', { name: 'Tickets' }))
        expect(document.querySelector('.side-nav__tip')).toHaveTextContent('Tickets')
        await user.keyboard('{Escape}')
        expect(document.querySelector('.side-nav__tip')).toBeNull()
        screen.getByRole('link', { name: 'Settings' }).focus()
        await waitFor(() => expect(document.querySelector('.side-nav__tip')).not.toBeNull())
        expect(document.querySelector('.side-nav__tip')).toHaveTextContent('Settings')
    })
})
