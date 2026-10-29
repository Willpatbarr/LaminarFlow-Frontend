import { cleanup, screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { connectSyncToSession, wipeLocalData } from '@/sync'
import { listRoutes, TEAM } from '@/sync/testing/harness'
import { openApp, startAnonymous } from '@/testing/app'
import { bodyOf, ok, problem } from '@/testing/fetch'

// The aspect type editor through the real route tree, with only `fetch` stubbed (LAM-98).

let disconnect = () => {}

beforeEach(async () => {
    await startAnonymous()
    disconnect = connectSyncToSession()
})

afterEach(async () => {
    cleanup()
    disconnect()
    await wipeLocalData()
    vi.unstubAllGlobals()
})

const field = (id: string, label: string, position: number) => ({ id, label, position })
const aType = (fields = [field('f1', 'Goal', 1), field('f2', 'Risks', 2), field('f3', 'Owner', 3)]) => ({
    id: 'a-1',
    team_id: TEAM.id,
    name: 'Brief',
    fields,
})

const labels = () => within(screen.getByRole('list', { name: 'Fields' })).getAllByRole('textbox').map((i) => (i as HTMLInputElement).value)

describe('the aspect type editor', () => {
    it('lists the team types and links to each', async () => {
        await openApp(`/teams/${TEAM.id}/aspect-types`, {
            ...listRoutes(),
            'GET /api/v1/aspect-types': () => ok({ items: [{ id: 'a-1', team_id: TEAM.id, name: 'Brief', fields: [] }] }),
        })
        const link = await screen.findByRole('link', { name: 'Brief' })
        expect(link).toHaveAttribute('href', `/teams/${TEAM.id}/aspect-types/a-1`)
    })

    it('reorders with the Move buttons by sending the whole list', async () => {
        const sent: unknown[] = []
        await openApp(`/teams/${TEAM.id}/aspect-types/a-1`, {
            ...listRoutes(),
            'GET /api/v1/aspect-types/a-1': () => ok(aType()),
            'POST /api/v1/aspect-types/a-1/reorder': async (request) => {
                const body = await bodyOf(request)
                sent.push(body)
                const order: string[] = body.field_ids
                return ok(aType(order.map((id, i) => field(id, { f1: 'Goal', f2: 'Risks', f3: 'Owner' }[id]!, i + 1))))
            },
        })
        const user = userEvent.setup()
        await screen.findByRole('list', { name: 'Fields' })
        await user.click(screen.getByRole('button', { name: 'Move Owner up' }))
        await waitFor(() => expect(labels()).toEqual(['Goal', 'Owner', 'Risks']))
        expect(sent).toEqual([{ field_ids: ['f1', 'f3', 'f2'] }])
    })

    it('reloads and says so on a field_set_mismatch', async () => {
        await openApp(`/teams/${TEAM.id}/aspect-types/a-1`, {
            ...listRoutes(),
            'GET /api/v1/aspect-types/a-1': () => ok(aType()),
            'POST /api/v1/aspect-types/a-1/reorder': () => problem(409, 'field_set_mismatch'),
        })
        const user = userEvent.setup()
        await screen.findByRole('list', { name: 'Fields' })
        await user.click(screen.getByRole('button', { name: 'Move Owner up' }))
        expect(await screen.findByText(/changed elsewhere/)).toBeInTheDocument()
    })

    it('shows the document count before removing a field, and removes only on confirm', async () => {
        let removed = false
        await openApp(`/teams/${TEAM.id}/aspect-types/a-1`, {
            ...listRoutes(),
            'GET /api/v1/aspect-types/a-1': () => ok(aType()),
            'GET /api/v1/aspect-types/a-1/fields/f2/usage': () => ok({ document_count: 4 }),
            'DELETE /api/v1/aspect-types/a-1/fields/f2': () => {
                removed = true
                return new Response(null, { status: 204 })
            },
        })
        const user = userEvent.setup()
        await screen.findByRole('list', { name: 'Fields' })
        await user.click(screen.getByRole('button', { name: 'Remove Risks' }))
        const dialog = await screen.findByRole('dialog')
        expect(dialog).toHaveTextContent('4 documents have a value in this field')
        expect(removed).toBe(false)
        await user.click(within(dialog).getByRole('button', { name: 'Remove field' }))
        await waitFor(() => expect(labels()).toEqual(['Goal', 'Owner']))
        expect(removed).toBe(true)
    })

    it('adds a field and renames one', async () => {
        const puts: unknown[] = []
        await openApp(`/teams/${TEAM.id}/aspect-types/a-1`, {
            ...listRoutes(),
            'GET /api/v1/aspect-types/a-1': () => ok(aType([field('f1', 'Goal', 1)])),
            'POST /api/v1/aspect-types/a-1/fields': async (request) => ok(field('f9', (await bodyOf(request)).label, 2)),
            'PUT /api/v1/aspect-types/a-1/fields/f1': async (request) => {
                const body = await bodyOf(request)
                puts.push(body)
                return ok(field('f1', body.label, 1))
            },
        })
        const user = userEvent.setup()
        await screen.findByRole('list', { name: 'Fields' })
        await user.type(screen.getByLabelText('New field label'), 'Budget')
        await user.click(screen.getByRole('button', { name: 'Add field' }))
        await waitFor(() => expect(labels()).toEqual(['Goal', 'Budget']))

        const goal = screen.getByLabelText('Label of Goal')
        await user.clear(goal)
        await user.type(goal, 'Aim')
        await user.tab()
        await waitFor(() => expect(puts).toEqual([{ label: 'Aim' }]))
    })
})
