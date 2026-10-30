import { screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { connectSyncToSession, wipeLocalData } from '@/sync'
import { listRoutes, TEAM, ticket } from '@/sync/testing/harness'
import { openApp, ME_BODY } from '@/testing/app'
import { bodyOf, ok } from '@/testing/fetch'
import { ALL_PERMISSIONS } from '@/testing/permissions'

import { reorderedIds } from './StatusEditor'

// The editor on its team-settings page, against the real store and engine with
// only fetch stubbed.
let disconnect: () => void

beforeEach(() => {
    disconnect = connectSyncToSession()
})

afterEach(async () => {
    disconnect()
    await wipeLocalData()
    vi.unstubAllGlobals()
})

const SETTINGS = `/teams/${TEAM.id}/settings`
const BASE = `/api/v1/teams/${TEAM.id}/statuses`

const rows = () => within(screen.getByRole('list', { name: 'Status order' })).getAllByRole('listitem')
const nameOf = (row: HTMLElement) => (within(row).getByRole('textbox') as HTMLInputElement).value

describe('reorderedIds', () => {
    it('moves one id to a place and keeps the rest in order', () => {
        expect(reorderedIds(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
        expect(reorderedIds(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a'])
        expect(reorderedIds(['a', 'b', 'c'], 'b', 9)).toEqual(['a', 'c', 'b'])
    })
})

it('lists the team\'s statuses in order on the settings page, reachable from the team page', async () => {
    await openApp(`/teams/${TEAM.id}`, listRoutes())
    expect(await screen.findByRole('link', { name: 'Team settings' })).toHaveAttribute('href', SETTINGS)

    const history = await openApp(SETTINGS, listRoutes())
    expect(history.get()).toBe(SETTINGS)
    expect(await screen.findByRole('heading', { name: 'Team settings' })).toBeInTheDocument()
    await waitFor(() => expect(rows().map(nameOf)).toEqual(['To Do', 'In Progress', 'Done']))
})

it('renames a status when the field is left, and sends the new name', async () => {
    const user = userEvent.setup()
    let body: unknown
    await openApp(SETTINGS, {
        ...listRoutes(),
        [`PUT ${BASE}/s-todo`]: async (request) => {
            body = await bodyOf(request)
            return ok({ ...TEAM.statuses[0], name: 'Backlog' })
        },
    })
    const field = await screen.findByLabelText('Name of To Do')

    await user.clear(field)
    await user.type(field, 'Backlog')
    await user.tab()

    await waitFor(() => expect(rows().map(nameOf)).toEqual(['Backlog', 'In Progress', 'Done']))
    await waitFor(() => expect(body).toMatchObject({ name: 'Backlog' }))
})

it('moves a status down with its button, as one reorder of the whole team', async () => {
    const user = userEvent.setup()
    let order: unknown
    await openApp(SETTINGS, {
        ...listRoutes(),
        [`POST ${BASE}/reorder`]: async (request) => {
            order = ((await bodyOf(request)) as { status_ids: string[] }).status_ids
            return ok({ ...TEAM, statuses: [TEAM.statuses[1], TEAM.statuses[0], TEAM.statuses[2]].map((s, i) => ({ ...s, position: i + 1 })) })
        },
    })
    await screen.findByLabelText('Name of To Do')

    await user.click(screen.getByRole('button', { name: 'Move To Do down' }))

    await waitFor(() => expect(rows().map(nameOf)).toEqual(['In Progress', 'To Do', 'Done']))
    await waitFor(() => expect(order).toEqual(['s-doing', 's-todo', 's-done']))
})

it('adds a status at the end', async () => {
    const user = userEvent.setup()
    let body: unknown
    await openApp(SETTINGS, {
        ...listRoutes(),
        [`POST ${BASE}`]: async (request) => {
            body = await bodyOf(request)
            return ok({ id: 's-new', name: 'Review', color: 'slate', position: 4, category: 'not_started' })
        },
    })
    await screen.findByLabelText('Name of To Do')

    await user.type(screen.getByLabelText('New status name'), 'Review')
    await user.click(screen.getByRole('button', { name: 'Add status' }))

    await waitFor(() => expect(rows().map(nameOf)).toEqual(['To Do', 'In Progress', 'Done', 'Review']))
    await waitFor(() => expect(body).toEqual({ name: 'Review', color: 'slate', category: 'not_started', position: 4 }))
})

// LAM-192: an existing status can be recoloured, by hue name.
describe('colour', () => {
    it('shows the hue the status is drawn in and sends the chosen hue name', async () => {
        const user = userEvent.setup()
        let body: unknown
        await openApp(SETTINGS, {
            ...listRoutes(),
            [`PUT ${BASE}/s-todo`]: async (request) => {
                body = await bodyOf(request)
                return ok({ ...TEAM.statuses[0], color: 'violet' })
            },
        })
        const select = (await screen.findByLabelText('Colour of To Do')) as HTMLSelectElement
        expect(select.value).toBe('slate') // the seed's #94a3b8

        await user.selectOptions(select, 'Violet')

        await waitFor(() => expect(body).toMatchObject({ color: 'violet' }))
        await waitFor(() => expect((screen.getByLabelText('Colour of To Do') as HTMLSelectElement).value).toBe('violet'))
    })

    it('is disabled with a tooltip without team:write', async () => {
        await openApp(SETTINGS, listRoutes(), { ...ME_BODY, permissions: ALL_PERMISSIONS.filter((p) => p !== 'team:write') })
        const select = await screen.findByLabelText('Colour of To Do')
        expect(select).toBeDisabled()
        expect(select.closest('.status-editor__colour')).toHaveAttribute('title', "You don't have permission to recolour statuses.")
    })
})

describe('delete', () => {
    it('asks where the tickets go when some use the status, and sends move_to', async () => {
        const user = userEvent.setup()
        let query = ''
        await openApp(SETTINGS, {
            ...listRoutes([ticket({ id: 't-1', status_id: 's-doing' }), ticket({ id: 't-2', status_id: 's-doing' })]),
            [`DELETE ${BASE}/s-doing`]: (request) => {
                query = new URL(request.url).search
                return new Response(null, { status: 204 })
            },
        })
        await screen.findByLabelText('Name of In Progress')

        await user.click(screen.getByRole('button', { name: 'Delete In Progress' }))
        const dialog = await screen.findByRole('dialog', { name: /Delete .In Progress./ })
        expect(dialog).toHaveTextContent('2 tickets use this status')
        await user.selectOptions(within(dialog).getByLabelText('Move tickets to'), 'Done')
        await user.click(within(dialog).getByRole('button', { name: 'Delete status' }))

        await waitFor(() => expect(rows().map(nameOf)).toEqual(['To Do', 'Done']))
        await waitFor(() => expect(query).toBe('?move_to=s-done'))
    })

    it('does not ask when no open ticket uses it, and moves any archived ones to its neighbour', async () => {
        const user = userEvent.setup()
        let query = ''
        await openApp(SETTINGS, {
            ...listRoutes([]),
            [`DELETE ${BASE}/s-done`]: (request) => {
                query = new URL(request.url).search
                return new Response(null, { status: 204 })
            },
        })
        await screen.findByLabelText('Name of Done')

        await user.click(screen.getByRole('button', { name: 'Delete Done' }))

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        await waitFor(() => expect(rows().map(nameOf)).toEqual(['To Do', 'In Progress']))
        await waitFor(() => expect(query).toBe('?move_to=s-doing'))
    })
})

// LAM-188: on a phone each status is one line, and its actions live in a ⋯ menu.
describe('on a phone', () => {
    function phone() {
        vi.stubGlobal(
            'matchMedia',
            vi.fn().mockImplementation((query: string) => ({
                matches: true,
                media: query,
                addEventListener: () => {},
                removeEventListener: () => {},
            })),
        )
    }

    it('folds move and delete into a menu per row, and moving from it reorders', async () => {
        phone()
        const user = userEvent.setup()
        let order: unknown
        await openApp(SETTINGS, {
            ...listRoutes(),
            [`POST ${BASE}/reorder`]: async (request) => {
                order = ((await bodyOf(request)) as { status_ids: string[] }).status_ids
                return ok({ ...TEAM, statuses: [TEAM.statuses[1], TEAM.statuses[0], TEAM.statuses[2]].map((s, i) => ({ ...s, position: i + 1 })) })
            },
        })
        await screen.findByLabelText('Name of To Do')
        expect(screen.queryByRole('button', { name: 'Move To Do down' })).not.toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Actions for To Do' }))
        const menu = await screen.findByRole('menu')
        expect(within(menu).getByRole('menuitem', { name: /Move up/ })).toHaveAttribute('aria-disabled', 'true')
        expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
        await user.click(within(menu).getByRole('menuitem', { name: 'Move down' }))

        await waitFor(() => expect(order).toEqual(['s-doing', 's-todo', 's-done']))
    })

    it('puts a Colour section in the row menu, and choosing a hue sends it', async () => {
        phone()
        const user = userEvent.setup()
        let body: unknown
        await openApp(SETTINGS, {
            ...listRoutes(),
            [`PUT ${BASE}/s-todo`]: async (request) => {
                body = await bodyOf(request)
                return ok({ ...TEAM.statuses[0], color: 'teal' })
            },
        })
        await screen.findByLabelText('Name of To Do')
        expect(screen.queryByLabelText('Colour of To Do')).not.toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Actions for To Do' }))
        const menu = await screen.findByRole('menu')
        expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(8)
        expect(within(menu).getByRole('menuitemradio', { name: 'Colour Slate' })).toHaveAttribute('aria-checked', 'true')
        await user.click(within(menu).getByRole('menuitemradio', { name: 'Colour Teal' }))

        await waitFor(() => expect(body).toMatchObject({ color: 'teal' }))
    })

    it('starts the Labels section folded, with its count', async () => {
        phone()
        await openApp(SETTINGS, listRoutes())
        await screen.findByLabelText('Name of To Do')
        const summary = screen.getByRole('heading', { name: 'Labels' }).closest('summary')!
        expect(summary).toHaveTextContent(/Labels\s*\(\d+\)/)
        expect(summary.closest('details')).not.toHaveAttribute('open')
    })
})
