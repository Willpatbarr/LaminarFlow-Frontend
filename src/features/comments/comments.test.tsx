import { screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import openapi from '../../../api/openapi.json?raw'

import { connectSyncToSession, wipeLocalData } from '@/sync'
import { doc, listRoutes, ME, ticket } from '@/sync/testing/harness'
import { openApp, startAnonymous } from '@/testing/app'
import { bodyOf, ok, problem } from '@/testing/fetch'

import { COMMENT_MAX } from './limits'

// The comment thread through the real route tree, store and engine, with only
// `fetch` stubbed (LAM-112).

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

const stamp = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const comment = (overrides: Record<string, unknown> = {}) => ({
    id: 'c-1',
    ticket_id: 't-1',
    document_id: null,
    field_id: null,
    region_start: null,
    region_end: null,
    author_id: ME,
    body: 'First thoughts',
    review_status: null,
    ...stamp,
    ...overrides,
})

const thread = () => screen.findByRole('region', { name: /Comments/ })

describe('limits', () => {
    it('COMMENT_MAX is the contract\'s', () => {
        const schemas = (JSON.parse(openapi) as { components: { schemas: Record<string, any> } }).components.schemas
        expect(schemas.CreateCommentInputBody.properties.body.maxLength).toBe(COMMENT_MAX)
        expect(schemas.UpdateCommentInputBody.properties.body.maxLength).toBe(COMMENT_MAX)
    })
})

describe('the thread on the ticket page', () => {
    it('marks "(edited)" from edited_at, not from updated_at (a review status change moves only updated_at)', async () => {
        await openApp('/tickets/t-1', {
            ...listRoutes([ticket({ id: 't-1' })], [], [], {
                comments: [
                    comment({ id: 'c-1', updated_at: '2026-01-05T00:00:00Z', edited_at: null }),
                    comment({ id: 'c-2', body: 'Reworded', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-06T00:00:00Z', edited_at: '2026-01-06T00:00:00Z' }),
                ],
            }),
        })
        const items = await within(await thread()).findAllByRole('listitem')
        expect(within(items[0]).queryByText('(edited)')).toBeNull()
        expect(within(items[1]).getByText('(edited)')).toBeInTheDocument()
    })

    it('lists comments oldest first and offers Edit and Delete on the viewer\'s own only', async () => {
        await openApp('/tickets/t-1', {
            ...listRoutes([ticket({ id: 't-1' })], [], [], {
                comments: [
                    comment({ id: 'c-2', author_id: 'acc-other', body: 'Second', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' }),
                    comment({ id: 'c-1' }),
                    comment({ id: 'c-x', ticket_id: 't-other', body: 'Elsewhere' }),
                ],
            }),
        })
        const region = await thread()
        const items = await within(region).findAllByRole('listitem')
        expect(items).toHaveLength(2)
        expect(within(items[0]).getByText('You')).toBeInTheDocument()
        expect(within(items[1]).getByText('Someone else')).toBeInTheDocument()
        expect(within(items[0]).getByRole('button', { name: 'Edit comment' })).toBeInTheDocument()
        expect(within(items[1]).queryByRole('button', { name: 'Edit comment' })).toBeNull()
        expect(within(items[1]).queryByRole('button', { name: 'Delete comment' })).toBeNull()
        expect(within(region).queryByText('Elsewhere')).toBeNull()
    })

    it('posts a comment at once and sends it with the ticket, the body and a key', async () => {
        const posts: { key: string | null; body: Record<string, unknown> }[] = []
        await openApp('/tickets/t-1', {
            ...listRoutes([ticket({ id: 't-1' })]),
            'POST /api/v1/comments': async (request) => {
                const body = await bodyOf(request)
                posts.push({ key: request.headers.get('Idempotency-Key'), body })
                return ok(comment({ id: 'c-new', body: body.body }))
            },
        })
        const region = await thread()
        const user = userEvent.setup()
        await user.click(await within(region).findByRole('textbox', { name: 'Add a comment' }))
        await user.keyboard('Looks right')
        await user.click(within(region).getByRole('button', { name: 'Comment' }))

        expect(await within(region).findByText('Looks right')).toBeInTheDocument()
        await waitFor(() => expect(posts).toHaveLength(1))
        expect(posts[0].body).toEqual({ ticket_id: 't-1', body: 'Looks right' })
        expect(posts[0].key).toBeTruthy()
    })

    it('does not offer an empty comment', async () => {
        await openApp('/tickets/t-1', listRoutes([ticket({ id: 't-1' })]))
        const region = await thread()
        expect(await within(region).findByRole('button', { name: 'Comment' })).toBeDisabled()
    })

    it('edits your comment through PUT with only the body', async () => {
        const puts: Record<string, unknown>[] = []
        await openApp('/tickets/t-1', {
            ...listRoutes([ticket({ id: 't-1' })], [], [], { comments: [comment()] }),
            'PUT /api/v1/comments/c-1': async (request) => {
                const body = await bodyOf(request)
                puts.push(body)
                return ok(comment({ body: body.body, updated_at: '2026-01-03T00:00:00Z' }))
            },
        })
        const region = await thread()
        const user = userEvent.setup()
        await user.click(await within(region).findByRole('button', { name: 'Edit comment' }))
        const box = await within(region).findByRole('textbox', { name: 'Edit comment' })
        await waitFor(() => expect(box).toHaveFocus())
        await user.keyboard('!')
        await user.click(within(region).getByRole('button', { name: 'Save' }))

        await waitFor(() => expect(puts).toHaveLength(1))
        expect(puts[0]).toEqual({ body: 'First thoughts!' })
    })

    it('deletes your comment after asking', async () => {
        let deleted = false
        await openApp('/tickets/t-1', {
            ...listRoutes([ticket({ id: 't-1' })], [], [], { comments: [comment()] }),
            'DELETE /api/v1/comments/c-1': () => ((deleted = true), new Response(null, { status: 204 })),
        })
        const region = await thread()
        const user = userEvent.setup()
        await user.click(await within(region).findByRole('button', { name: 'Delete comment' }))
        await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))

        await waitFor(() => expect(within(region).queryByText('First thoughts')).toBeNull())
        await waitFor(() => expect(deleted).toBe(true))
    })

    it('says so on the comment when the server refuses an edit as not the author\'s', async () => {
        await openApp('/tickets/t-1', {
            ...listRoutes([ticket({ id: 't-1' })], [], [], { comments: [comment()] }),
            'PUT /api/v1/comments/c-1': () => problem(403, 'comment_not_author'),
        })
        const region = await thread()
        const user = userEvent.setup()
        await user.click(await within(region).findByRole('button', { name: 'Edit comment' }))
        await user.click(await within(region).findByRole('textbox', { name: 'Edit comment' }))
        await user.keyboard('!')
        await user.click(within(region).getByRole('button', { name: 'Save' }))

        expect(await within(region).findByRole('alert')).toHaveTextContent('Only the author can change this comment.')
        await user.click(within(region).getByRole('button', { name: 'Discard my change' }))
        await waitFor(() => expect(within(region).queryByRole('alert')).toBeNull())
    })
})

describe('the thread on the document page', () => {
    it('shows the document\'s comments and posts with document_id', async () => {
        const posts: Record<string, unknown>[] = []
        await openApp('/documents/d-1', {
            ...listRoutes([], [doc({ id: 'd-1' })], [], {
                comments: [comment({ id: 'c-d', ticket_id: null, document_id: 'd-1', body: 'On the doc' })],
            }),
            'POST /api/v1/comments': async (request) => {
                const body = await bodyOf(request)
                posts.push(body)
                return ok(comment({ id: 'c-new', ticket_id: null, document_id: 'd-1', body: body.body }))
            },
        })
        const region = await thread()
        expect(await within(region).findByText('On the doc')).toBeInTheDocument()
        const user = userEvent.setup()
        await user.click(within(region).getByRole('textbox', { name: 'Add a comment' }))
        await user.keyboard('Agreed')
        await user.click(within(region).getByRole('button', { name: 'Comment' }))
        await waitFor(() => expect(posts).toEqual([{ document_id: 'd-1', body: 'Agreed' }]))
    })
})

