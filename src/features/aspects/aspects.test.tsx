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

    it('deletes an unused type after a confirm and returns to the list', async () => {
        let deleted = false
        await openApp(`/teams/${TEAM.id}/aspect-types/a-1`, {
            ...listRoutes(),
            'GET /api/v1/aspect-types/a-1': () => ok(aType()),
            'GET /api/v1/aspect-types': () => ok({ items: deleted ? [] : [aType()] }),
            'GET /api/v1/aspect-types/a-1/usage': () => ok({ document_count: 0, archived_count: 0 }),
            'DELETE /api/v1/aspect-types/a-1': () => {
                deleted = true
                return new Response(null, { status: 204 })
            },
        })
        const user = userEvent.setup()
        await screen.findByRole('list', { name: 'Fields' })
        await user.click(screen.getByRole('button', { name: 'Delete type' }))
        const dialog = await screen.findByRole('dialog')
        expect(dialog).toHaveTextContent('No document uses this type')
        expect(deleted).toBe(false)
        await user.click(within(dialog).getByRole('button', { name: 'Delete type' }))
        await screen.findByRole('heading', { name: 'Aspect types' })
        expect(deleted).toBe(true)
    })

    it('explains with the counts, and offers no delete, when documents use the type', async () => {
        let deleteCalls = 0
        await openApp(`/teams/${TEAM.id}/aspect-types/a-1`, {
            ...listRoutes(),
            'GET /api/v1/aspect-types/a-1': () => ok(aType()),
            'GET /api/v1/aspect-types/a-1/usage': () => ok({ document_count: 3, archived_count: 2 }),
            'DELETE /api/v1/aspect-types/a-1': () => {
                deleteCalls++
                return new Response(null, { status: 204 })
            },
        })
        const user = userEvent.setup()
        await screen.findByRole('list', { name: 'Fields' })
        await user.click(screen.getByRole('button', { name: 'Delete type' }))
        const dialog = await screen.findByRole('dialog')
        expect(dialog).toHaveTextContent('Used by 3 documents (2 archived).')
        expect(dialog).toHaveTextContent('before deleting the type')
        expect(within(dialog).queryByRole('button', { name: 'Delete type' })).not.toBeInTheDocument()
        await user.click(within(dialog).getByRole('button', { name: 'Close' }))
        expect(deleteCalls).toBe(0)
    })

    it('shows the fresh counts when a document appeared before the delete landed', async () => {
        await openApp(`/teams/${TEAM.id}/aspect-types/a-1`, {
            ...listRoutes(),
            'GET /api/v1/aspect-types/a-1': () => ok(aType()),
            'GET /api/v1/aspect-types/a-1/usage': () => ok({ document_count: 0, archived_count: 0 }),
            'DELETE /api/v1/aspect-types/a-1': () =>
                new Response(
                    JSON.stringify({ title: 'Conflict', status: 409, code: 'aspect_type_in_use', document_count: 1, archived_count: 1 }),
                    { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
                ),
        })
        const user = userEvent.setup()
        await screen.findByRole('list', { name: 'Fields' })
        await user.click(screen.getByRole('button', { name: 'Delete type' }))
        await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete type' }))
        await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Used by 1 document (1 archived).'))
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

describe('importing and exporting a type (LAM-119)', () => {
    const fileOf = (content: unknown, name = 'brief.json') => new File([JSON.stringify(content)], name, { type: 'application/json' })
    const valid = { format_version: 1, name: 'Brief', fields: [{ label: 'Goal', position: 1 }, { label: 'Risks', position: 2 }] }

    it('previews a picked file, imports on confirm, opens the copy and says it was renamed', async () => {
        const sent: unknown[] = []
        await openApp(`/teams/${TEAM.id}/aspect-types`, {
            ...listRoutes(),
            'GET /api/v1/aspect-types': () => ok({ items: [] }),
            'POST /api/v1/aspect-types/import': async (request) => {
                sent.push(await bodyOf(request))
                return ok({ ...aType(), id: 'a-2', name: 'Brief (2)' })
            },
            'GET /api/v1/aspect-types/a-2': () => ok({ ...aType(), id: 'a-2', name: 'Brief (2)' }),
        })
        const user = userEvent.setup()
        await screen.findByRole('list', { name: 'Aspect types' })
        await user.upload(screen.getByLabelText('Aspect type file'), fileOf(valid))
        const dialog = await screen.findByRole('dialog', { name: /Import .Brief./ })
        expect(within(dialog).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Goal', 'Risks'])
        expect(sent).toEqual([])
        await user.click(within(dialog).getByRole('button', { name: 'Import' }))
        expect(await screen.findByLabelText('Aspect type name')).toHaveValue('Brief (2)')
        expect(sent).toEqual([{ team_id: TEAM.id, ...valid }])
        expect(screen.getByText(/Imported as .Brief \(2\)./)).toBeInTheDocument()
    })

    it('names what is wrong with a file and makes no request', async () => {
        await openApp(`/teams/${TEAM.id}/aspect-types`, {
            ...listRoutes(),
            'GET /api/v1/aspect-types': () => ok({ items: [] }),
        })
        const user = userEvent.setup()
        await screen.findByRole('list', { name: 'Aspect types' })
        await user.upload(screen.getByLabelText('Aspect type file'), fileOf({ ...valid, fields: [{ label: '', position: 1 }] }, 'bad.json'))
        expect(await screen.findByRole('alert')).toHaveTextContent('bad.json: fields[0].label: must not be empty')
        expect(screen.queryByRole('dialog')).toBeNull()
    })

    it("shows the field the server's 422 names", async () => {
        await openApp(`/teams/${TEAM.id}/aspect-types`, {
            ...listRoutes(),
            'GET /api/v1/aspect-types': () => ok({ items: [] }),
            'POST /api/v1/aspect-types/import': () =>
                problem(422, 'unprocessable_entity', [{ location: 'body.fields[1].label', message: 'too long' }]),
        })
        const user = userEvent.setup()
        await screen.findByRole('list', { name: 'Aspect types' })
        await user.upload(screen.getByLabelText('Aspect type file'), fileOf(valid))
        await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Import' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('body.fields[1].label: too long')
    })

    it('exports the type as a named file', async () => {
        const saved: { name: string; text: Promise<string> }[] = []
        URL.createObjectURL = (blob: Blob) => {
            saved.push({ name: '', text: blob.text() })
            return 'blob:x'
        }
        URL.revokeObjectURL = () => {}
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            saved[saved.length - 1].name = this.download
        })
        await openApp(`/teams/${TEAM.id}/aspect-types/a-1`, {
            ...listRoutes(),
            'GET /api/v1/aspect-types/a-1': () => ok(aType()),
            'GET /api/v1/aspect-types/a-1/export': () => ok(valid),
        })
        const user = userEvent.setup()
        await screen.findByRole('list', { name: 'Fields' })
        await user.click(screen.getByRole('button', { name: 'Export JSON' }))
        await waitFor(() => expect(saved).toHaveLength(1))
        expect(saved[0].name).toBe('brief.aspect-type.json')
        expect(JSON.parse(await saved[0].text)).toEqual(valid)
        click.mockRestore()
    })
})

// LAM-195: on a phone each field is one line, and its actions live in a ⋯ menu.
describe('the aspect type editor on a phone', () => {
    it('folds move and remove into a menu per field, and moving from it reorders', async () => {
        vi.stubGlobal(
            'matchMedia',
            vi.fn().mockImplementation((query: string) => ({
                matches: true,
                media: query,
                addEventListener: () => {},
                removeEventListener: () => {},
            })),
        )
        let order: unknown
        await openApp(`/teams/${TEAM.id}/aspect-types/a-1`, {
            ...listRoutes(),
            'GET /api/v1/aspect-types/a-1': () => ok(aType()),
            'POST /api/v1/aspect-types/a-1/reorder': async (request) => {
                const body = await bodyOf(request)
                order = body.field_ids
                return ok(aType([field('f2', 'Risks', 1), field('f1', 'Goal', 2), field('f3', 'Owner', 3)]))
            },
        })
        const user = userEvent.setup()
        await screen.findByRole('list', { name: 'Fields' })
        expect(screen.queryByRole('button', { name: 'Move Goal down' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Remove Goal' })).not.toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Actions for Goal' }))
        const menu = await screen.findByRole('menu')
        expect(within(menu).getByRole('menuitem', { name: /Move up/ })).toHaveAttribute('aria-disabled', 'true')
        expect(within(menu).getByRole('menuitem', { name: 'Remove' })).toBeInTheDocument()
        await user.click(within(menu).getByRole('menuitem', { name: 'Move down' }))
        await waitFor(() => expect(order).toEqual(['f2', 'f1', 'f3']))
    })
})
