import { fireEvent, screen, waitFor } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearMembers } from '@/features/members/members'
import { connectSyncToSession, wipeLocalData } from '@/sync'
import { publishActivityFrame } from '@/sync/activityEvents'
import { deferred, doc, listRoutes, ticket } from '@/sync/testing/harness'
import { openApp, startAnonymous } from '@/testing/app'
import { bodyOf, ok, problem } from '@/testing/fetch'

// The activity feed on the ticket and document pages (LAM-114), through the real
// route tree with only `fetch` stubbed.

let disconnect = () => {}

beforeEach(async () => {
    await startAnonymous()
    disconnect = connectSyncToSession()
})

afterEach(async () => {
    disconnect()
    await wipeLocalData()
    clearMembers()
    vi.unstubAllGlobals()
})

const entry = (overrides: Record<string, unknown> = {}) => ({
    id: 'a-1',
    entity_type: 'ticket',
    entity_id: 't-1',
    actor_id: null,
    kind: 'created',
    field: null,
    summary_before: null,
    summary_after: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
})
const page = (items: unknown[]) => ok({ items, has_more: false, next_cursor: null })
const routes = (answer: () => Response | Promise<Response>, asked: unknown[] = []) => ({
    ...listRoutes([ticket({ id: 't-1', title: 'Write the outbox', version: 3 })], [doc({ id: 'd-1', title: 'Notes' })]),
    'POST /api/v1/activity/list': async (request: Request) => {
        asked.push(await bodyOf(request))
        return answer()
    },
})

describe('activity feed', () => {
    it('asks for the ticket\'s history and says "Someone" for a deleted account', async () => {
        const asked: unknown[] = []
        await openApp(
            '/tickets/t-1',
            routes(() => page([entry({ actor_id: null })]), asked),
        )
        expect(await screen.findByText(/Someone created this ticket/)).toBeInTheDocument()
        expect(asked[0]).toMatchObject({
            filter: {
                op: 'and',
                conditions: [
                    { field: 'entity_type', op: 'eq', value: 'ticket' },
                    { field: 'entity_id', op: 'eq', value: 't-1' },
                ],
            },
        })
    })

    it('puts a live activity.created entry at the top', async () => {
        await openApp(
            '/tickets/t-1',
            routes(() => page([entry()])),
        )
        await screen.findByText(/Someone created this ticket/)
        publishActivityFrame({
            type: 'activity.created',
            ticket_id: 't-1',
            activity: entry({
                id: 'a-2',
                kind: 'archived',
                created_at: '2026-01-02T00:00:00Z',
            }),
        })
        await waitFor(() => {
            const lines = screen.getAllByRole('listitem').filter((li) => li.hasAttribute('data-activity-kind'))
            expect(lines.map((li) => li.getAttribute('data-activity-kind'))).toEqual(['archived', 'created'])
        })
    })

    it('shows the history on a document page too', async () => {
        await openApp(
            '/documents/d-1',
            routes(() =>
                page([
                    entry({
                        entity_type: 'document',
                        entity_id: 'd-1',
                        kind: 'archived',
                    }),
                ]),
            ),
        )
        expect(await screen.findByText(/Someone archived this document/)).toBeInTheDocument()
    })

    it('is quiet about an empty history and about a refusal', async () => {
        await openApp(
            '/tickets/t-1',
            routes(() => problem(404, 'not_found')),
        )
        expect(await screen.findByText('No activity yet.')).toBeInTheDocument()
    })

    it('shows a loading placeholder, not an empty section, until the first answer', async () => {
        const answer = deferred<Response>()
        await openApp('/tickets/t-1', routes(() => answer.promise))
        const feed = await screen.findByRole('region', { name: 'Activity' })
        expect(await screen.findByText('Loading activity…')).toBeInTheDocument()
        expect(feed).toHaveAttribute('aria-busy', 'true')
        expect(screen.queryByText('No activity yet.')).not.toBeInTheDocument()

        answer.resolve(page([entry()]))
        expect(await screen.findByText(/Someone created this ticket/)).toBeInTheDocument()
        expect(screen.queryByText('Loading activity…')).not.toBeInTheDocument()
        expect(feed).not.toHaveAttribute('aria-busy')
    })

    it('says "No activity yet." only once loaded with no entries', async () => {
        await openApp('/tickets/t-1', routes(() => page([])))
        expect(await screen.findByText('No activity yet.')).toBeInTheDocument()
        expect(screen.queryByText('Loading activity…')).not.toBeInTheDocument()
    })

    it('says so when the history cannot be loaded, and Retry asks again', async () => {
        let up = false
        await openApp('/tickets/t-1', routes(() => (up ? page([entry()]) : problem(500, 'internal'))))
        expect(await screen.findByText(/The history is not available right now/)).toBeInTheDocument()
        expect(screen.queryByText('No activity yet.')).not.toBeInTheDocument()

        up = true
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
        expect(await screen.findByText(/Someone created this ticket/)).toBeInTheDocument()
        expect(screen.queryByText(/not available right now/)).not.toBeInTheDocument()
    })
})
