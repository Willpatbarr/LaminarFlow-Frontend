import { render, screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearMembers } from '@/features/members/members'
import { connectSyncToSession, wipeLocalData } from '@/sync'
import { doc, listRoutes, ME } from '@/sync/testing/harness'
import { openApp, startAnonymous } from '@/testing/app'
import { bodyOf, ok, problem, stubFetch } from '@/testing/fetch'

import { clearReviewFeed } from './feed'
import { RequestReviewDialog } from './RequestReviewDialog'

// Review requests through the real route tree, store and engine, with only
// `fetch` stubbed (LAM-121).

let disconnect = () => {}

beforeEach(async () => {
    await startAnonymous()
    disconnect = connectSyncToSession()
})

afterEach(async () => {
    disconnect()
    await wipeLocalData()
    clearMembers()
    clearReviewFeed()
    vi.unstubAllGlobals()
})

const stamp = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const request = (overrides: Record<string, unknown> = {}) => ({
    id: 'rr-1',
    ticket_id: null,
    document_id: 'd-1',
    field_id: null,
    region_start: 0,
    region_end: 5,
    author_id: 'acc-sam',
    body: 'Is this wording right?',
    review_status: 'pending',
    anchor_text: 'Hello',
    reviewers: [{ account_id: ME }],
    ...stamp,
    ...overrides,
})
const member = (id: string, name: string) => ({ account_id: id, display_name: name, email: `${name}@x.test`, role: 'member', ...stamp })
const MEMBERS = { 'POST /api/v1/members/list': () => ok({ items: [member(ME, 'Ada'), member('acc-sam', 'Sam Ortiz'), member('acc-bo', 'Bo Lin')], has_more: false, next_cursor: null }) }
const list = (items: unknown[]) => ({ 'POST /api/v1/review-requests/list': () => ok({ items, has_more: false, next_cursor: null }) })

const withRequest = (rr = request(), extra: Record<string, unknown> = {}) => ({
    ...listRoutes([], [doc({ id: 'd-1', body: { content: 'Hello world' } })], [], { comments: [rr] }),
    ...MEMBERS,
    ...list([rr]),
    ...extra,
})

describe('open requests on a document', () => {
    it('counts them, quotes the words, names who asked, and marks the field in the margin', async () => {
        await openApp('/documents/d-1', withRequest())
        expect(await screen.findByRole('button', { name: /1 open review request/ })).toBeInTheDocument()
        expect(await screen.findByText('Review requested by Sam Ortiz')).toBeInTheDocument()
        expect(await screen.findByText('Hello', { selector: 'blockquote' })).toBeInTheDocument()
        expect(screen.getByRole('note')).toHaveTextContent('1 open review request')
    })

    it('keeps a decided request visible: the outcome, who decided, the note, and a margin mark', async () => {
        const decided = request({ review_status: 'changes_requested', decided_by: 'acc-bo', decision_note: 'Shorter, please.', reviewers: [{ account_id: 'acc-bo' }] })
        await openApp('/documents/d-1', withRequest(decided))
        expect((await screen.findAllByText('Bo Lin requested changes')).length).toBeGreaterThan(0)
        expect(await screen.findByTestId('decision-note')).toHaveTextContent('Shorter, please.')
        expect(screen.getByRole('note')).toHaveTextContent('Bo Lin requested changes')
        // Nothing is "open", and nothing is hidden.
        expect(screen.queryByRole('button', { name: /open review request/ })).toBeNull()
        expect(screen.getByText('Hello', { selector: 'blockquote' })).toBeInTheDocument()
    })

    it('says "A reviewer" when the decider is not known, and "You" for the signed-in account', async () => {
        await openApp('/documents/d-1', withRequest(request({ review_status: 'approved', decided_by: null })))
        expect((await screen.findAllByText('A reviewer approved')).length).toBeGreaterThan(0)
    })

    it('the requester sees the outcome too', async () => {
        const decided = request({ review_status: 'approved', decided_by: 'acc-bo', author_id: ME, reviewers: [{ account_id: 'acc-bo' }] })
        await openApp('/documents/d-1', withRequest(decided))
        expect((await screen.findAllByText('Bo Lin approved')).length).toBeGreaterThan(0)
        expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull()
    })

    it('says so, neutrally, when the quoted words are no longer at the range', async () => {
        await openApp('/documents/d-1', withRequest(request({ anchor_text: 'Howdy' })))
        expect(await screen.findByText('The text has changed since this was requested.')).toBeInTheDocument()
    })

    it('says why a request is open again, without blame, when the server gives a reason', async () => {
        await openApp('/documents/d-1', withRequest(request({ stale_reason: 'anchored text changed' })))
        expect(await screen.findByText('This is open again because the text it points at was edited.')).toBeInTheDocument()
    })

    it('says who had approved the earlier text when a stale approval is open again', async () => {
        await openApp('/documents/d-1', withRequest(request({ stale_reason: 'anchored text changed', decided_by: 'acc-bo', decided_at: stamp.updated_at })))
        expect(await screen.findByText(/Bo Lin had approved the earlier text\./)).toBeInTheDocument()
    })

    it('does not name anyone when the earlier approver is not known', async () => {
        await openApp('/documents/d-1', withRequest(request({ stale_reason: 'anchored text changed', decided_by: null })))
        expect(await screen.findByText(/It had been approved on the earlier text\./)).toBeInTheDocument()
    })

    it('says nothing about it when there is no reason', async () => {
        await openApp('/documents/d-1', withRequest(request({ stale_reason: null })))
        await screen.findByText('Review requested by Sam Ortiz')
        expect(screen.queryByText(/open again/)).toBeNull()
        expect(screen.queryByText(/had approved/)).toBeNull()
    })
})

describe('what a reviewer can do', () => {
    it('Approve is a PUT of the status', async () => {
        const puts: unknown[] = []
        await openApp(
            '/documents/d-1',
            withRequest(request(), {
                'PUT /api/v1/review-requests/rr-1': async (r: Request) => (puts.push(await bodyOf(r)), ok(request({ review_status: 'approved' }))),
            }),
        )
        const user = userEvent.setup()
        await user.click(await screen.findByRole('button', { name: 'Approve' }))
        await waitFor(() => expect(puts).toEqual([{ review_status: 'approved' }]))
    })

    it('Request changes asks for a note first, and the note may be left empty', async () => {
        const puts: unknown[] = []
        await openApp(
            '/documents/d-1',
            withRequest(request(), {
                'PUT /api/v1/review-requests/rr-1': async (r: Request) => (puts.push(await bodyOf(r)), ok(request({ review_status: 'changes_requested', decided_by: ME, updated_at: '2026-01-02T00:00:00Z' }))),
            }),
        )
        const user = userEvent.setup()
        await user.click(await screen.findByRole('button', { name: 'Request changes' }))
        expect(puts).toEqual([])
        const form = (await screen.findByRole('textbox', { name: /What would help/ })).closest('form')!
        await user.click(within(form).getByRole('button', { name: 'Request changes' }))
        await waitFor(() => expect(puts).toEqual([{ review_status: 'changes_requested' }]))
        expect((await screen.findAllByText('You requested changes')).length).toBeGreaterThan(0)
    })

    it('Request changes sends the note it was given', async () => {
        const puts: unknown[] = []
        await openApp(
            '/documents/d-1',
            withRequest(request(), {
                'PUT /api/v1/review-requests/rr-1': async (r: Request) => (
                    puts.push(await bodyOf(r)),
                    ok(request({ review_status: 'changes_requested', decided_by: ME, decision_note: 'Shorter, please.', updated_at: '2026-01-02T00:00:00Z' }))
                ),
            }),
        )
        const user = userEvent.setup()
        await user.click(await screen.findByRole('button', { name: 'Request changes' }))
        const box = await screen.findByRole('textbox', { name: /What would help/ })
        await user.type(box, 'Shorter, please.')
        await user.click(within(box.closest('form')!).getByRole('button', { name: 'Request changes' }))
        await waitFor(() => expect(puts).toEqual([{ review_status: 'changes_requested', decision_note: 'Shorter, please.' }]))
        expect(await screen.findByTestId('decision-note')).toHaveTextContent('Shorter, please.')
    })

    it('Request changes goes out on Ctrl+Enter in the note, once, and plain Enter is a new line', async () => {
        const puts: unknown[] = []
        await openApp(
            '/documents/d-1',
            withRequest(request(), {
                'PUT /api/v1/review-requests/rr-1': async (r: Request) => (
                    puts.push(await bodyOf(r)),
                    ok(request({ review_status: 'changes_requested', decided_by: ME, decision_note: 'a\nb', updated_at: '2026-01-02T00:00:00Z' }))
                ),
            }),
        )
        const user = userEvent.setup()
        await user.click(await screen.findByRole('button', { name: 'Request changes' }))
        const box = await screen.findByRole('textbox', { name: /What would help/ })
        const form = box.closest('form')!
        expect(within(form).getByRole('button', { name: 'Request changes' })).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter')
        expect(form.querySelector('.shortcut-hint')).not.toBeNull()
        await user.type(box, 'a{Enter}b')
        expect(puts).toEqual([])
        await user.keyboard('{Control>}{Enter}{Enter}{/Control}')
        await waitFor(() => expect(puts).toHaveLength(1))
        expect(puts).toEqual([{ review_status: 'changes_requested', decision_note: 'a\nb' }])
    })

    it('Cancel on the note sends nothing', async () => {
        const puts: unknown[] = []
        await openApp(
            '/documents/d-1',
            withRequest(request(), { 'PUT /api/v1/review-requests/rr-1': async (r: Request) => (puts.push(await bodyOf(r)), ok(request())) }),
        )
        const user = userEvent.setup()
        await user.click(await screen.findByRole('button', { name: 'Request changes' }))
        await user.click(await screen.findByRole('button', { name: 'Cancel' }))
        expect(screen.queryByRole('textbox', { name: /What would help/ })).toBeNull()
        expect(puts).toEqual([])
    })

    it('a decided request can be reopened by a reviewer', async () => {
        const puts: unknown[] = []
        await openApp(
            '/documents/d-1',
            withRequest(request({ review_status: 'approved', decided_by: ME }), {
                'PUT /api/v1/review-requests/rr-1': async (r: Request) => (puts.push(await bodyOf(r)), ok(request({ decided_by: ME, updated_at: '2026-01-02T00:00:00Z' }))),
            }),
        )
        await userEvent.setup().click(await screen.findByRole('button', { name: 'Reopen' }))
        await waitFor(() => expect(puts).toEqual([{ review_status: 'pending' }]))
    })

    it('Comment posts a plain comment on the document, not a PUT', async () => {
        const posts: Record<string, unknown>[] = []
        await openApp(
            '/documents/d-1',
            withRequest(request(), {
                'POST /api/v1/comments': async (r: Request) => {
                    const body = await bodyOf(r)
                    posts.push(body)
                    return ok({ ...request({ id: 'c-new', review_status: null, author_id: ME, body: body.body }) })
                },
            }),
        )
        const user = userEvent.setup()
        const region = await screen.findByRole('region', { name: /Review requests/ })
        await user.click(within(region).getByRole('button', { name: 'Comment' }))
        await user.type(await screen.findByRole('textbox', { name: 'Your comment' }), 'Maybe say "Hi"')
        await user.click(screen.getByRole('button', { name: 'Post comment' }))
        await waitFor(() => expect(posts).toEqual([{ document_id: 'd-1', body: 'Maybe say "Hi"' }]))
    })

    it('says a refusal without blame', async () => {
        await openApp(
            '/documents/d-1',
            withRequest(request(), { 'PUT /api/v1/review-requests/rr-1': () => problem(403, 'not_a_reviewer') }),
        )
        await userEvent.setup().click(await screen.findByRole('button', { name: 'Approve' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Only the people asked to review can do this.')
    })

    it('offers no answer to someone who was not asked', async () => {
        await openApp('/documents/d-1', withRequest(request({ reviewers: [{ account_id: 'acc-bo' }] })))
        await screen.findByText('Review requested by Sam Ortiz')
        await waitFor(() => expect(screen.getByText(/Asked: Bo Lin/)).toBeInTheDocument())
        expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Request changes' })).toBeNull()
    })
})

describe('asking for a document\'s requests', () => {
    it('names every status, since the server lists only pending ones otherwise', async () => {
        const asked: { filter: { conditions: { field: string; value: unknown }[] } }[] = []
        await openApp(
            '/documents/d-1',
            withRequest(request({ reviewers: [{ account_id: 'acc-bo' }] }), {
                'POST /api/v1/review-requests/list': async (r: Request) => {
                    const body = (await bodyOf(r)) as { filter: { conditions: { field: string; value: unknown }[] } }
                    asked.push(body)
                    const forDocument = body.filter.conditions.some((c) => c.field === 'document_id')
                    return ok({ items: forDocument ? [request({ reviewers: [{ account_id: 'acc-bo' }] })] : [], has_more: false, next_cursor: null })
                },
            }),
        )
        await screen.findByText('Review requested by Sam Ortiz')
        await waitFor(() => expect(asked.some((a) => a.filter.conditions.some((c) => c.field === 'document_id'))).toBe(true))
        const forDocument = asked.find((a) => a.filter.conditions.some((c) => c.field === 'document_id'))!
        const status = forDocument.filter.conditions.find((c) => c.field === 'review_status')
        expect(JSON.stringify(status?.value)).toBe(JSON.stringify(['pending', 'approved', 'changes_requested']))
    })
})

describe('Needs my review', () => {
    it('lists the requests that name me and counts them in the sidebar', async () => {
        await openApp('/reviews', withRequest())
        expect(await screen.findByRole('heading', { name: 'Needs my review' })).toBeInTheDocument()
        const link = await screen.findByRole('link', { name: /Design notes/ })
        expect(link).toHaveAttribute('href', '/documents/d-1')
        expect(await screen.findByText(/asked by Sam Ortiz/)).toBeInTheDocument()
        await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: /Needs my review/ })).toHaveTextContent('1'))
    })

    it('asks the server for the signed-in account only', async () => {
        const asked: unknown[] = []
        await openApp(
            '/reviews',
            withRequest(request(), {
                'POST /api/v1/review-requests/list': async (r: Request) => (asked.push(await bodyOf(r)), ok({ items: [], has_more: false, next_cursor: null })),
            }),
        )
        await waitFor(() => expect(asked.length).toBeGreaterThan(0))
        expect(asked[0]).toMatchObject({ filter: { op: 'and', conditions: [{ field: 'reviewer_id', op: 'eq', value: ME }] } })
    })
})

describe('author names on comments', () => {
    it('shows a display name from the member list instead of "Someone else"', async () => {
        await openApp('/documents/d-1', {
            ...listRoutes([], [doc({ id: 'd-1' })], [], {
                comments: [{ id: 'c-1', ticket_id: null, document_id: 'd-1', field_id: null, region_start: null, region_end: null, author_id: 'acc-sam', body: 'hi', review_status: null, ...stamp }],
            }),
            ...MEMBERS,
        })
        expect(await screen.findByText('Sam Ortiz', { selector: '.comments__author' })).toBeInTheDocument()
        expect(screen.queryByText('Someone else')).toBeNull()
    })
})

describe('the request dialog\'s reviewer list', () => {
    it('shows names, with the email only on hover', async () => {
        stubFetch({ ...MEMBERS })
        render(() => <RequestReviewDialog documentId="d-1" fieldId={null} quote="Hello" start={0} end={5} accountId={ME} onDone={() => {}} onClose={() => {}} />)
        const box = await screen.findByRole('checkbox', { name: /Sam Ortiz/ })
        expect(screen.queryByText('Sam Ortiz@x.test')).toBeNull()
        expect(box.closest('label')).toHaveAttribute('title', 'Sam Ortiz@x.test')
    })
})

describe('the request dialog', () => {
    const props = { documentId: 'd-1', fieldId: null, quote: 'Hello', start: 0, end: 5, accountId: ME, onDone: () => {}, onClose: () => {} }

    it('sends the note, the range, the chosen reviewers and a key; not the asker as a choice', async () => {
        let sent: { body: Record<string, unknown>; key: string | null } | undefined
        stubFetch({
            ...MEMBERS,
            'POST /api/v1/review-requests': async (r) => {
                sent = { body: await bodyOf(r), key: r.headers.get('Idempotency-Key') }
                return ok(request())
            },
        })
        const done = vi.fn()
        render(() => <RequestReviewDialog {...props} onDone={done} />)
        const user = userEvent.setup()
        expect(await screen.findByRole('checkbox', { name: /Sam Ortiz/ })).toBeInTheDocument()
        expect(screen.queryByRole('checkbox', { name: /Ada/ })).toBeNull()
        expect(screen.getByRole('button', { name: 'Request review' })).toBeDisabled()

        await user.type(screen.getByRole('textbox', { name: 'Note for the reviewers' }), 'Please check')
        await user.click(screen.getByRole('checkbox', { name: /Sam Ortiz/ }))
        await user.click(screen.getByRole('button', { name: 'Request review' }))
        await waitFor(() => expect(done).toHaveBeenCalled())
        expect(sent?.body).toEqual({ document_id: 'd-1', region_start: 0, region_end: 5, body: 'Please check', reviewer_ids: ['acc-sam'] })
        expect(sent?.key).toBeTruthy()
    })

    it('keeps the dialog open with the server\'s words when it refuses, and reuses the key on retry', async () => {
        const keys: (string | null)[] = []
        stubFetch({
            ...MEMBERS,
            'POST /api/v1/review-requests': (r) => (keys.push(r.headers.get('Idempotency-Key')), problem(422, 'validation', [{ location: 'body.reviewer_ids[0]', message: 'is not a member of this workspace' }])),
        })
        render(() => <RequestReviewDialog {...props} />)
        const user = userEvent.setup()
        await user.type(await screen.findByRole('textbox', { name: 'Note for the reviewers' }), 'Please check')
        await user.click(await screen.findByRole('checkbox', { name: /Sam Ortiz/ }))
        await user.click(screen.getByRole('button', { name: 'Request review' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('is not a member of this workspace')
        await user.click(screen.getByRole('button', { name: 'Request review' }))
        await waitFor(() => expect(keys).toHaveLength(2))
        expect(keys[0]).toBe(keys[1])
    })
})
