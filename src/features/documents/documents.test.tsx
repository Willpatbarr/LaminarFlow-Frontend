import { cleanup, screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { connectSyncToSession, sync, wipeLocalData } from '@/sync'
import { doc, docBody, listRoutes } from '@/sync/testing/harness'
import { openApp, startAnonymous } from '@/testing/app'
import { bodyOf, ok } from '@/testing/fetch'

// The document page through the real route tree, store and engine, with only
// `fetch` stubbed (LAM-96).

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

const editor = () => screen.findByRole('textbox', { name: 'Text' })

async function openDocument(body: Record<string, string>, overrides: Parameters<typeof doc>[0] = {}) {
    const puts: { ifMatch: string | null; body: Record<string, unknown> }[] = []
    const stored = doc({ id: 'd-1', title: 'Notes', version: 2, body, ...overrides })
    await openApp('/documents/d-1', {
        ...listRoutes([], [stored]),
        'PUT /api/v1/documents/d-1': async (request) => {
            const sent = await bodyOf(request)
            puts.push({ ifMatch: request.headers.get('If-Match'), body: sent })
            return ok(docBody({ ...stored, ...sent, version: 3 }))
        },
    })
    return puts
}

describe('the document page', () => {
    it('shows the title and renders the stored Markdown', async () => {
        await openDocument({ content: '# Plan\n\n- one\n- two' })
        expect(await screen.findByLabelText('Title')).toHaveValue('Notes')
        const text = await editor()
        expect(await within(text).findByRole('heading', { level: 1, name: 'Plan' })).toBeInTheDocument()
        expect(within(text).getAllByRole('listitem')).toHaveLength(2)
    })

    it('draws an internal link as a chip to its route', async () => {
        await openDocument({ content: 'See [the ticket](lf://ticket/t-9).' })
        const link = await within(await editor()).findByRole('link', { name: 'the ticket' })
        expect(link).toHaveAttribute('href', '/tickets/t-9')
    })

    it('saves a title edit through the outbox with If-Match, and says Saved', async () => {
        const puts = await openDocument({ content: 'Hello' })
        const title = await screen.findByLabelText('Title')
        const user = userEvent.setup()
        await user.clear(title)
        await user.type(title, 'Renamed')
        await user.tab()

        await waitFor(() => expect(puts).toHaveLength(1))
        expect(puts[0].ifMatch).toBe('"2"')
        expect(puts[0].body).toMatchObject({ title: 'Renamed', body: { content: 'Hello' } })
        await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument())
        expect(sync.outbox).toEqual([])
    })

    it('autosaves typed text after a pause, as Markdown, keeping the other body keys', async () => {
        const puts = await openDocument({ content: '', other: 'kept' })
        const text = await editor()
        const user = userEvent.setup()
        await user.click(text)
        await user.keyboard('Hello world')

        await waitFor(() => expect(puts).toHaveLength(1), { timeout: 3000 })
        expect(puts[0].body).toMatchObject({ body: { content: 'Hello world', other: 'kept' } })
    })

    it('says plainly when there is no such document', async () => {
        await openDocument({ content: '' })
        cleanup()
        await openApp('/documents/nope', listRoutes())
        expect(await screen.findByRole('heading', { name: 'Document not found' })).toBeInTheDocument()
    })
})

describe('an edit that lost to someone else\'s', () => {
    async function conflicted() {
        const theirs = docBody({ id: 'd-1', title: 'Notes', version: 5, body: { content: 'Their words' } })
        await openApp('/documents/d-1', {
            ...listRoutes([], [doc({ id: 'd-1', title: 'Notes', version: 2, body: { content: 'Old' } })]),
            'PUT /api/v1/documents/d-1': () =>
                new Response(
                    JSON.stringify({
                        title: 'Conflict',
                        status: 409,
                        code: 'document_conflict',
                        current: theirs,
                        changed_at: new Date().toISOString(),
                    }),
                    { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
                ),
        })
        const title = await screen.findByLabelText('Title')
        const user = userEvent.setup()
        await user.clear(title)
        await user.type(title, 'Mine')
        await user.tab()
        return { user, title }
    }

    it('shows the panel, keeps the work on screen and pauses editing', async () => {
        const { title } = await conflicted()
        const region = await screen.findByRole('region', { name: 'This document needs a decision' })
        expect(region).toHaveTextContent("Your change hasn't been saved to the server. It's still here.")
        expect(title).toHaveValue('Mine')
        expect(title).toHaveAttribute('readonly')
        expect(screen.getByText('Needs a decision: someone else changed this document')).toBeInTheDocument()
        expect(sync.outbox).toMatchObject([{ state: 'conflict' }])
    })

    it('keeps theirs: the change is dropped and their version shows', async () => {
        const { user, title } = await conflicted()
        const region = await screen.findByRole('region', { name: 'This document needs a decision' })
        await user.click(within(region).getByRole('button', { name: 'Keep theirs' }))
        await waitFor(() => expect(sync.outbox).toEqual([]))
        await waitFor(() => expect(title).toHaveValue('Notes'))
        expect(await screen.findByText('Kept their version. Your change was discarded.')).toBeInTheDocument()
    })
})

describe('browsing documents (LAM-97)', () => {
    const docs = [
        doc({ id: 'd-a', title: 'In project', project_id: 'p-1', updated_at: '2025-12-31T00:00:00Z' }),
        doc({ id: 'd-b', title: 'Loose note', project_id: null, updated_at: '2025-12-30T00:00:00Z' }),
        doc({ id: 'd-c', title: 'Aspect one', type: 'aspect', aspect_type_id: 'at-1', project_id: null, body: {}, updated_at: '2025-12-29T00:00:00Z' }),
    ]
    const names = () => within(screen.getByRole('list', { name: 'Documents' })).getAllByRole('listitem').map((item) => item.querySelector('a')?.textContent)

    it('lists every document at /documents, links each to its own URL', async () => {
        await openApp('/documents', listRoutes([], docs))
        expect(await screen.findByRole('link', { name: 'In project' })).toHaveAttribute('href', '/documents/d-a')
        expect(names()).toEqual(['In project', 'Loose note', 'Aspect one'])
    })

    it('filters by project and by type', async () => {
        await openApp('/documents', listRoutes([], docs))
        await screen.findByRole('link', { name: 'In project' })
        const user = userEvent.setup()
        await user.selectOptions(screen.getByLabelText('Project'), 'p-1')
        expect(names()).toEqual(['In project'])
        await user.selectOptions(screen.getByLabelText('Project'), '')
        await user.selectOptions(screen.getByLabelText('Type'), 'aspect')
        expect(names()).toEqual(['Aspect one'])
    })

    it("shows only that project's documents on the project's Documents tab", async () => {
        await openApp('/projects/p-1/documents', listRoutes([], docs))
        expect(await screen.findByRole('link', { name: 'In project' })).toBeInTheDocument()
        expect(names()).toEqual(['In project'])
        expect(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('link', { name: 'Tickets' })).toHaveAttribute('href', '/projects/p-1')
    })

    it('New document opens the new document', async () => {
        const history = await openApp('/documents', {
            ...listRoutes([], docs),
            'POST /api/v1/documents': async (request) =>
                ok(docBody({ id: 'd-new', ...(await bodyOf(request)) }), 201),
        })
        await screen.findByRole('link', { name: 'In project' })
        await userEvent.setup().click(screen.getByRole('button', { name: 'New document' }))
        await waitFor(() => expect(history.get()).toMatch(/^\/documents\/.+/))
    })
})
