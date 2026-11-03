import { screen, waitFor, within } from '@solidjs/testing-library'
import type { Editor } from '@tiptap/core'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { connectSyncToSession, wipeLocalData } from '@/sync'
import { doc, docBody, listRoutes, ticket } from '@/sync/testing/harness'
import { openApp, startAnonymous } from '@/testing/app'
import { bodyOf, ok } from '@/testing/fetch'

import { clearMentionOffer } from './mentionOffer'

// "Also link this ticket?" after a ticket is mentioned with @ in a document
// (LAM-225), through the real document page, with only `fetch` stubbed.

let disconnect = () => {}

beforeEach(async () => {
    await startAnonymous()
    disconnect = connectSyncToSession()
})

afterEach(async () => {
    clearMentionOffer()
    disconnect()
    await wipeLocalData()
    vi.unstubAllGlobals()
})

function server(linked: unknown[] = []) {
    const state = { tickets: linked }
    const calls: string[] = []
    const routes = {
        ...listRoutes(
            [ticket({ id: 't-1', title: 'Write the outbox', version: 3 }), ticket({ id: 't-2', title: 'Fix the sidebar', version: 1 })],
            [doc({ id: 'd-1', title: 'Design notes' })],
        ),
        'GET /api/v1/documents/d-1': () => ok({ ...docBody({ id: 'd-1' }), tickets: state.tickets }),
        'POST /api/v1/tickets/t-1/documents': async (request: Request) => {
            calls.push(`link t-1 ${(await bodyOf(request) as { document_id: string }).document_id}`)
            state.tickets = [...state.tickets, { id: 't-1', title: 'Write the outbox', archived_at: null }]
            return new Response(null, { status: 204 })
        },
        'POST /api/v1/tickets/t-2/documents': async () => {
            calls.push('link t-2')
            state.tickets = [...state.tickets, { id: 't-2', title: 'Fix the sidebar', archived_at: null }]
            return new Response(null, { status: 204 })
        },
    }
    return { routes, calls }
}

// Mentions a ticket the way a user does: the trigger, the query, then Enter on the list.
async function mention(title: string) {
    const box = await screen.findByRole('textbox', { name: 'Document text' })
    const editor = (box as unknown as { editor: Editor }).editor
    editor.commands.focus('end')
    editor.view.dispatch(editor.state.tr.insertText(` @${title}`))
    await screen.findByRole('listbox')
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
}

const tickets = async () => within(await screen.findByRole('region', { name: 'Tickets' }))

describe('Also link this ticket?', () => {
    it('is offered after a ticket is mentioned, and the mention alone links nothing', async () => {
        const { routes, calls } = server()
        await openApp('/documents/d-1', routes)
        const section = await tickets()
        await section.findByText('No tickets linked.')
        await mention('outbox')

        const offer = await screen.findByText('Also link this ticket?')
        expect(offer).toBeInTheDocument()
        expect(screen.getByText('Write the outbox', { selector: '.toast__detail' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Link' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument()
        expect(calls).toEqual([])
        expect(section.getByText('No tickets linked.')).toBeInTheDocument()
    })

    it('is not offered when the ticket is already linked', async () => {
        const { routes } = server([{ id: 't-1', title: 'Write the outbox', archived_at: null }])
        await openApp('/documents/d-1', routes)
        const section = await tickets()
        await section.findByRole('link', { name: 'Write the outbox' })
        await mention('outbox')
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(screen.queryByText('Also link this ticket?')).toBeNull()
    })

    it('links on "Link": the Tickets section updates, and the offer goes', async () => {
        const { routes, calls } = server()
        await openApp('/documents/d-1', routes)
        const user = userEvent.setup()
        const section = await tickets()
        await section.findByText('No tickets linked.')
        await mention('outbox')
        await user.click(await screen.findByRole('button', { name: 'Link' }))

        expect(await section.findByRole('link', { name: 'Write the outbox' })).toBeInTheDocument()
        expect(calls).toEqual(['link t-1 d-1'])
        await waitFor(() => expect(screen.queryByText('Also link this ticket?')).toBeNull())
    })

    it('goes away on "Not now" without linking, and the mention stays', async () => {
        const { routes, calls } = server()
        await openApp('/documents/d-1', routes)
        const user = userEvent.setup()
        const section = await tickets()
        await section.findByText('No tickets linked.')
        await mention('outbox')
        await user.click(await screen.findByRole('button', { name: 'Not now' }))

        expect(screen.queryByText('Also link this ticket?')).toBeNull()
        expect(calls).toEqual([])
        expect(screen.getByRole('link', { name: 'Write the outbox', description: '' })).toBeInTheDocument()
        expect(section.getByText('No tickets linked.')).toBeInTheDocument()
    })

    it('merges several mentions into one offer, and links them all', async () => {
        const { routes, calls } = server()
        await openApp('/documents/d-1', routes)
        const user = userEvent.setup()
        const section = await tickets()
        await section.findByText('No tickets linked.')
        await mention('outbox')
        await mention('sidebar')

        expect(await screen.findByText('Also link these 2 tickets?')).toBeInTheDocument()
        expect(screen.getAllByRole('button', { name: 'Link' })).toHaveLength(1)
        await user.click(screen.getByRole('button', { name: 'Link' }))
        await waitFor(() => expect(calls).toEqual(['link t-1 d-1', 'link t-2']))
    })

    it('says so calmly when the link fails, and keeps the mention', async () => {
        const { routes } = server()
        await openApp('/documents/d-1', {
            ...routes,
            'POST /api/v1/tickets/t-1/documents': () => {
                throw new TypeError('Failed to fetch')
            },
        })
        const user = userEvent.setup()
        const section = await tickets()
        await section.findByText('No tickets linked.')
        await mention('outbox')
        await user.click(await screen.findByRole('button', { name: 'Link' }))

        expect(await screen.findByText('Could not link this ticket.')).toBeInTheDocument()
        expect(screen.getByText(/The mention is still in the text/)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Write the outbox' })).toBeInTheDocument()
    })

    it('hints in the empty Tickets section that mentions do not link', async () => {
        const { routes } = server()
        await openApp('/documents/d-1', routes)
        const section = await tickets()
        expect(
            await section.findByText("Mentions don't link on their own. Use Link a ticket, or accept the offer when you mention one."),
        ).toBeInTheDocument()
    })
})
