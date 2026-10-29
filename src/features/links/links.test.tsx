import { screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { connectSyncToSession, wipeLocalData } from '@/sync'
import { publishLinkFrame } from '@/sync/linkEvents'
import { doc, docBody, listRoutes, ticket } from '@/sync/testing/harness'
import { openApp, startAnonymous } from '@/testing/app'
import { bodyOf, ok, problem } from '@/testing/fetch'

import { settledId } from './settled'

// Ticket-document links (LAM-120) through the real route tree, with only
// `fetch` stubbed.

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

const linkedDoc = (overrides: Record<string, unknown> = {}) => ({
    id: 'd-1',
    title: 'Design notes',
    type: 'normal',
    aspect_type_id: null,
    archived_at: null,
    ...overrides,
})

// A server that remembers the links it is told about.
function linkServer(initial: { documents?: unknown[]; tickets?: unknown[] } = {}) {
    const state = { documents: initial.documents ?? [], tickets: initial.tickets ?? [] }
    const calls: string[] = []
    const routes = {
        ...listRoutes([ticket({ id: 't-1', title: 'Write the outbox', version: 3 })], [doc({ id: 'd-1', title: 'Design notes' }), doc({ id: 'd-2', title: 'Runbook' })]),
        'GET /api/v1/tickets/t-1': () => ok({ ...ticket({ id: 't-1', version: 3 }), archived_at: null, documents: state.documents }),
        'GET /api/v1/documents/d-1': () => ok({ ...docBody({ id: 'd-1' }), tickets: state.tickets }),
        'POST /api/v1/tickets/t-1/documents': async (request: Request) => {
            const body = (await bodyOf(request)) as { document_id: string }
            calls.push(`link ${body.document_id}`)
            const found = body.document_id === 'd-2' ? linkedDoc({ id: 'd-2', title: 'Runbook' }) : linkedDoc()
            if (!state.documents.some((d) => (d as { id: string }).id === found.id)) state.documents = [...state.documents, found]
            if (body.document_id === 'd-1' && state.tickets.length === 0) {
                state.tickets = [{ id: 't-1', title: 'Write the outbox', archived_at: null }]
            }
            return new Response(null, { status: 204 })
        },
        'DELETE /api/v1/tickets/t-1/documents/d-1': () => {
            calls.push('unlink d-1')
            state.documents = state.documents.filter((d) => (d as { id: string }).id !== 'd-1')
            state.tickets = []
            return new Response(null, { status: 204 })
        },
    }
    return { routes, calls, state }
}

describe('Documents on the ticket page', () => {
    it('lists the linked documents, as links, with archived ones marked', async () => {
        const { routes } = linkServer({
            documents: [linkedDoc(), linkedDoc({ id: 'd-9', title: 'Old plan', archived_at: '2026-01-01T00:00:00Z' })],
        })
        await openApp('/tickets/t-1', routes)
        const section = within(await screen.findByRole('region', { name: 'Documents' }))
        expect(await section.findByRole('link', { name: 'Design notes' })).toHaveAttribute('href', '/documents/d-1')
        expect(section.getByRole('link', { name: 'Old plan' })).toBeInTheDocument()
        expect(section.getByText('Archived')).toBeInTheDocument()
    })

    it('says so when nothing is linked', async () => {
        const { routes } = linkServer()
        await openApp('/tickets/t-1', routes)
        const section = within(await screen.findByRole('region', { name: 'Documents' }))
        expect(await section.findByText('No documents linked.')).toBeInTheDocument()
    })

    it('links a document found by searching the local store, and not one already linked', async () => {
        const { routes, calls } = linkServer({ documents: [linkedDoc()] })
        await openApp('/tickets/t-1', routes)
        const user = userEvent.setup()
        const section = within(await screen.findByRole('region', { name: 'Documents' }))
        await section.findByRole('link', { name: 'Design notes' })
        await user.click(section.getByRole('button', { name: 'Link a document' }))

        const dialog = within(screen.getByRole('dialog', { name: 'Link a document' }))
        // Design notes is linked already: only the runbook is on offer.
        expect(dialog.queryByRole('radio', { name: 'Design notes' })).not.toBeInTheDocument()
        await user.type(dialog.getByLabelText('Search documents'), 'run')
        expect(dialog.getByRole('button', { name: 'Link' })).toBeDisabled()
        await user.click(dialog.getByRole('radio', { name: 'Runbook' }))
        await user.click(dialog.getByRole('button', { name: 'Link' }))

        expect(await section.findByRole('link', { name: 'Runbook' })).toBeInTheDocument()
        expect(calls).toEqual(['link d-2'])
    })

    it('unlinks without touching the document', async () => {
        const { routes, calls } = linkServer({ documents: [linkedDoc()] })
        await openApp('/tickets/t-1', routes)
        const user = userEvent.setup()
        const section = within(await screen.findByRole('region', { name: 'Documents' }))
        await user.click(await section.findByRole('button', { name: 'Unlink Design notes' }))

        await waitFor(() => expect(section.queryByRole('link', { name: 'Design notes' })).not.toBeInTheDocument())
        expect(calls).toEqual(['unlink d-1'])
        expect(await section.findByText('No documents linked.')).toBeInTheDocument()
    })

    it('says what went wrong when the server refuses a link, and lists what it has', async () => {
        const { routes } = linkServer()
        await openApp('/tickets/t-1', {
            ...routes,
            'POST /api/v1/tickets/t-1/documents': () => problem(404, 'not_found'),
        })
        const user = userEvent.setup()
        const section = within(await screen.findByRole('region', { name: 'Documents' }))
        await section.findByText('No documents linked.')
        await user.click(section.getByRole('button', { name: 'Link a document' }))
        const dialog = within(screen.getByRole('dialog'))
        await user.click(dialog.getByRole('radio', { name: 'Runbook' }))
        await user.click(dialog.getByRole('button', { name: 'Link' }))

        expect(await section.findByRole('alert')).toBeInTheDocument()
        expect(section.queryByRole('link', { name: 'Runbook' })).not.toBeInTheDocument()
    })

    it('makes a new document under the ticket\'s project and links it', async () => {
        const { routes, calls } = linkServer()
        const created: Record<string, unknown>[] = []
        await openApp('/tickets/t-1', {
            ...routes,
            'POST /api/v1/documents': async (request) => {
                const body = (await bodyOf(request)) as Record<string, unknown>
                created.push(body)
                return ok(docBody({ id: 'd-new', title: String(body.title), project_id: 'p-1', version: 1 }), 201)
            },
            'POST /api/v1/tickets/t-1/documents': async (request) => {
                const body = (await bodyOf(request)) as { document_id: string }
                calls.push(`link ${body.document_id}`)
                return new Response(null, { status: 204 })
            },
        })
        const user = userEvent.setup()
        const section = within(await screen.findByRole('region', { name: 'Documents' }))
        await section.findByText('No documents linked.')
        await user.click(section.getByRole('button', { name: 'New document' }))
        const dialog = within(screen.getByRole('dialog', { name: 'New document' }))
        expect(dialog.getByRole('button', { name: 'Create and link' })).toBeDisabled()
        await user.type(dialog.getByLabelText('Title'), 'Spec')
        await user.click(dialog.getByRole('button', { name: 'Create and link' }))

        expect(await section.findByRole('link', { name: 'Spec' })).toBeInTheDocument()
        await waitFor(() => expect(created).toMatchObject([{ title: 'Spec', type: 'normal', project_id: 'p-1' }]))
        await waitFor(() => expect(calls).toEqual(['link d-new']))
    })

    it('asks again when the change feed says a link was made elsewhere', async () => {
        const { routes, state } = linkServer()
        await openApp('/tickets/t-1', routes)
        const section = within(await screen.findByRole('region', { name: 'Documents' }))
        await section.findByText('No documents linked.')

        state.documents = [linkedDoc({ id: 'd-2', title: 'Runbook' })]
        publishLinkFrame({ type: 'ticket.document_linked', ticket_id: 'other', document_id: 'd-2' })
        publishLinkFrame({ type: 'ticket.document_linked', ticket_id: 't-1', document_id: 'd-2' })
        expect(await section.findByRole('link', { name: 'Runbook' })).toBeInTheDocument()
    })
})

describe('Tickets on the document page', () => {
    it('lists the linked tickets and unlinks one from this side', async () => {
        const { routes, calls, state } = linkServer({
            tickets: [{ id: 't-1', title: 'Write the outbox', archived_at: null }],
        })
        state.documents = [linkedDoc()]
        await openApp('/documents/d-1', routes)
        const user = userEvent.setup()
        const section = within(await screen.findByRole('region', { name: 'Tickets' }))
        expect(await section.findByRole('link', { name: 'Write the outbox' })).toHaveAttribute('href', '/tickets/t-1')
        await user.click(section.getByRole('button', { name: 'Unlink Write the outbox' }))
        await waitFor(() => expect(calls).toEqual(['unlink d-1']))
        expect(await section.findByText('No tickets linked.')).toBeInTheDocument()
    })

    it('links a ticket picked from the local store', async () => {
        const { routes, calls } = linkServer()
        await openApp('/documents/d-1', routes)
        const user = userEvent.setup()
        const section = within(await screen.findByRole('region', { name: 'Tickets' }))
        await section.findByText('No tickets linked.')
        await user.click(section.getByRole('button', { name: 'Link a ticket' }))
        const dialog = within(screen.getByRole('dialog', { name: 'Link a ticket' }))
        await user.click(dialog.getByRole('radio', { name: 'Write the outbox' }))
        await user.click(dialog.getByRole('button', { name: 'Link' }))
        await waitFor(() => expect(calls).toEqual(['link d-1']))
        expect(await section.findByRole('link', { name: 'Write the outbox' })).toBeInTheDocument()
    })
})

describe('settledId', () => {
    it('answers at once for an id the server has', async () => {
        expect(await settledId('t-1')).toEqual({ ok: true, data: 't-1' })
    })

    it('gives up on a temporary id nothing has replaced', async () => {
        const result = await settledId('tmp_never', 10)
        expect(result).toMatchObject({ ok: false, code: 'not_synced' })
    })
})

describe('publishLinkFrame', () => {
    it('ignores frames that are not link events', async () => {
        const { onLinkEvent } = await import('@/sync')
        const heard: unknown[] = []
        const off = onLinkEvent((event) => heard.push(event))
        publishLinkFrame({ type: 'ticket.updated', ticket_id: 't', document_id: 'd' })
        publishLinkFrame({ type: 'ticket.document_linked', ticket_id: 't' })
        publishLinkFrame(null)
        publishLinkFrame({ type: 'ticket.document_unlinked', ticket_id: 't', document_id: 'd' })
        off()
        expect(heard).toEqual([{ linked: false, ticketId: 't', documentId: 'd' }])
    })
})
