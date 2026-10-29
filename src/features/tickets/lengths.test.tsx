import type { Editor } from '@tiptap/core'
import { screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { connectSyncToSession, sync, updateTicket, wipeLocalData } from '@/sync'
import { listRoutes, ME, page, TEAM, ticket } from '@/sync/testing/harness'
import { bodyOf, ok, problem } from '@/testing/fetch'
import { openApp, startAnonymous } from '@/testing/app'

// The server's length limits (LAM-75), caught at the field before anything is
// queued - and the server's own refusal, which stays the authority.

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

const inMain = () => within(screen.getByRole('main'))

function editable() {
    const puts: Record<string, unknown>[] = []
    const routes = {
        ...listRoutes([ticket({ version: 3 })]),
        'PUT /api/v1/tickets/t-1': async (request: Request) => {
            const body = await bodyOf(request)
            puts.push(body)
            return ok(ticket({ ...body, version: 3 + puts.length, updated_by: ME }))
        },
    }
    return { routes, puts }
}

// Typing 200 characters one key at a time is slow and says nothing more than
// pasting them: what is under test is the field's reaction to the value.
async function paste(field: HTMLElement, text: string) {
    const user = userEvent.setup()
    await user.clear(field)
    await user.click(field)
    await user.paste(text)
    return user
}

// The description is the rich-text editor: its textbox is a contenteditable
// that ProseMirror owns, so text goes in through the TipTap editor it hangs off
// (`view.dom.editor`), which reports the edit the way typing does.
async function setDescription(field: HTMLElement, text: string) {
    const user = userEvent.setup()
    await user.click(field)
    const editor = (field as unknown as { editor: Editor }).editor
    editor.chain().focus().selectAll().insertContent(text, { parseOptions: { preserveWhitespace: 'full' } }).run()
    return user
}

describe('the title on the ticket page', () => {
    it('shows no count until the title is within a tenth of the limit', async () => {
        const { routes } = editable()
        await openApp('/tickets/t-1', routes)
        const title = await screen.findByLabelText('Title')

        await paste(title, 'x'.repeat(179))
        expect(inMain().queryByText(/ \/ 200/)).not.toBeInTheDocument()

        await paste(title, 'x'.repeat(180))
        expect(inMain().getByText('180 / 200')).toBeInTheDocument()
        expect(title).not.toHaveAttribute('aria-invalid')
        expect(title).toHaveAccessibleDescription('180 / 200')
    })

    it('accepts exactly 200 characters and saves them', async () => {
        const { routes, puts } = editable()
        await openApp('/tickets/t-1', routes)
        const user = await paste(await screen.findByLabelText('Title'), 'x'.repeat(200))
        await user.tab()

        await waitFor(() => expect(puts).toHaveLength(1))
        expect(puts[0].title).toBe('x'.repeat(200))
        expect(screen.getByLabelText('Title')).not.toHaveAttribute('aria-invalid')
    })

    it('marks 201 invalid with the count and a reason, keeps the text, and queues nothing', async () => {
        const { routes, puts } = editable()
        await openApp('/tickets/t-1', routes)
        const title = await screen.findByLabelText('Title')
        const user = await paste(title, 'x'.repeat(212))

        expect(title).toHaveAttribute('aria-invalid', 'true')
        expect(inMain().getByText('212 / 200')).toBeInTheDocument()
        const reason = 'Title can be at most 200 characters; this one is 12 over.'
        expect(inMain().getByText(reason)).toBeInTheDocument()
        expect(title).toHaveAccessibleDescription(`${reason} 212 / 200`)

        await user.tab()
        await new Promise((resolve) => setTimeout(resolve, 30))

        expect(title).toHaveValue('x'.repeat(212))
        expect(sync.outbox).toEqual([])
        expect(puts).toEqual([])
        expect(screen.queryByRole('button', { name: /change/ })).not.toBeInTheDocument()
        // Cut to size and leave: it saves.
        await paste(title, 'x'.repeat(200))
        await user.tab()
        await waitFor(() => expect(puts).toHaveLength(1))
        expect(title).not.toHaveAttribute('aria-invalid')
    })

    it('never cuts the text off: there is no maxlength to drop a paste', async () => {
        const { routes } = editable()
        await openApp('/tickets/t-1', routes)
        const title = await screen.findByLabelText('Title')

        expect(title).not.toHaveAttribute('maxlength')
        await paste(title, 'x'.repeat(5_000))
        expect(title).toHaveValue('x'.repeat(5_000))
    })

    it('counts code points as the server does: 200 emoji fit, 201 do not', async () => {
        const { routes, puts } = editable()
        await openApp('/tickets/t-1', routes)
        const title = await screen.findByLabelText('Title')

        const user = await paste(title, '😀'.repeat(201))
        expect(inMain().getByText('201 / 200')).toBeInTheDocument()
        expect(title).toHaveAttribute('aria-invalid', 'true')

        await paste(title, '😀'.repeat(200))
        expect(inMain().getByText('200 / 200')).toBeInTheDocument()
        expect(title).not.toHaveAttribute('aria-invalid')
        await user.tab()
        await waitFor(() => expect(puts).toHaveLength(1))
        expect(puts[0].title).toBe('😀'.repeat(200))
    })

    it('counts the title as it will be sent, without the spaces around it', async () => {
        const { routes, puts } = editable()
        await openApp('/tickets/t-1', routes)
        const user = await paste(await screen.findByLabelText('Title'), `  ${'x'.repeat(200)}  `)
        await user.tab()

        await waitFor(() => expect(puts).toHaveLength(1))
        expect(puts[0].title).toBe('x'.repeat(200))
    })

    it('says a blank title needs a title instead of quietly putting the old one back', async () => {
        const { routes, puts } = editable()
        await openApp('/tickets/t-1', routes)
        const title = await screen.findByLabelText('Title')
        const user = await paste(title, '   ')
        expect(title).not.toHaveAttribute('aria-invalid')

        await user.tab()

        expect(title).toHaveAttribute('aria-invalid', 'true')
        expect(title).toHaveAccessibleDescription('A ticket needs a title.')
        expect(puts).toEqual([])
        expect(sync.outbox).toEqual([])
    })
})

describe('the description on the ticket page', () => {
    it('allows 50,000 and refuses 50,001 without queuing it', async () => {
        const { routes, puts } = editable()
        await openApp('/tickets/t-1', routes)
        const description = await screen.findByRole('textbox', { name: 'Description' })

        const user = await setDescription(description, 'd'.repeat(50_001))
        expect(inMain().getByText('50,001 / 50,000')).toBeInTheDocument()
        expect(description).toHaveAttribute('aria-invalid', 'true')
        expect(inMain().getByText('Description can be at most 50,000 characters; this one is 1 over.')).toBeInTheDocument()
        await user.tab()
        await new Promise((resolve) => setTimeout(resolve, 30))
        expect(puts).toEqual([])
        expect(sync.outbox).toEqual([])
        expect(description).toHaveTextContent('d'.repeat(50_001))

        await setDescription(description, 'd'.repeat(50_000))
        expect(description).not.toHaveAttribute('aria-invalid')
        await user.tab()
        await waitFor(() => expect(puts).toHaveLength(1))
        expect((puts[0].description as string).length).toBe(50_000)
    })
})

describe('the New ticket dialog', () => {
    async function openDialog() {
        const created: { key: string | null; body: Record<string, unknown> }[] = []
        await openApp('/', {
            ...listRoutes([]),
            'POST /api/v1/tickets': async (request) => {
                const body = await bodyOf(request)
                created.push({ key: request.headers.get('Idempotency-Key'), body })
                return ok(ticket({ id: 't-9', ...body, version: 1, updated_by: ME }))
            },
        })
        const user = userEvent.setup()
        await waitFor(() => expect(screen.getByRole('button', { name: 'New ticket' })).toBeEnabled())
        await user.click(screen.getByRole('button', { name: 'New ticket' }))
        const dialog = screen.getByRole('dialog', { name: 'New ticket' })
        return { user, dialog, created, title: within(dialog).getByLabelText('Title') }
    }

    it('does not let an over-long title be created, and says why', async () => {
        const { user, dialog, created, title } = await openDialog()

        await user.paste('x'.repeat(201))
        expect(within(dialog).getByText('201 / 200')).toBeInTheDocument()
        expect(title).toHaveAttribute('aria-invalid', 'true')
        expect(within(dialog).getByText(/Title can be at most 200 characters; this one is 1 over\./)).toBeInTheDocument()
        const create = within(dialog).getByRole('button', { name: 'Create ticket' })
        expect(create).toBeDisabled()

        // Enter in the field must not get around the button.
        await user.keyboard('{Enter}')
        expect(sync.outbox).toEqual([])
        expect(created).toEqual([])
        expect(title).toHaveValue('x'.repeat(201))

        await user.clear(title)
        await user.paste('x'.repeat(200))
        expect(create).toBeEnabled()
        await user.click(create)

        await waitFor(() => expect(created).toHaveLength(1))
        expect((created[0].body.title as string).length).toBe(200)
    })

    it('sends the create with an Idempotency-Key', async () => {
        const { user, dialog, created } = await openDialog()
        await user.type(within(dialog).getByLabelText('Title'), 'Keyed{Enter}')

        await waitFor(() => expect(created).toHaveLength(1))
        expect(created[0].key).toMatch(/^[0-9a-f-]{36}$/)
    })
})

describe('first-run setup', () => {
    const none = () => page([])

    function setup() {
        return openApp('/', {
            'POST /api/v1/teams/list': none,
            'POST /api/v1/projects/list': none,
            'POST /api/v1/tickets/list': none,
            'POST /api/v1/documents/list': none,
            'POST /api/v1/comments/list': none,
        })
    }

    it('holds the button while a name is over 100 characters, with the count and the reason', async () => {
        await setup()
        const user = userEvent.setup()
        const project = await screen.findByLabelText('Project name')
        const submit = screen.getByRole('button', { name: 'Create team and project' })
        expect(submit).toBeEnabled()

        await user.clear(project)
        await user.paste('p'.repeat(101))
        expect(screen.getByText('101 / 100')).toBeInTheDocument()
        expect(project).toHaveAttribute('aria-invalid', 'true')
        expect(screen.getByText(/Project name can be at most 100 characters/)).toBeInTheDocument()
        expect(submit).toBeDisabled()

        const team = screen.getByLabelText('Team name')
        await user.clear(project)
        await user.paste('p'.repeat(100))
        expect(submit).toBeEnabled()
        await user.clear(team)
        await user.paste('t'.repeat(101))
        expect(team).toHaveAttribute('aria-invalid', 'true')
        expect(submit).toBeDisabled()
    })

    it("still shows the server's refusal of a name at that name", async () => {
        let teams = 0
        await openApp('/', {
            'POST /api/v1/teams/list': none,
            'POST /api/v1/projects/list': none,
            'POST /api/v1/tickets/list': none,
            'POST /api/v1/documents/list': none,
            'POST /api/v1/comments/list': none,
            'POST /api/v1/teams': () => {
                teams += 1
                return problem(422, 'unprocessable_entity', [
                    { location: 'body.name', message: 'expected length <= 100' },
                ])
            },
        })
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const user = userEvent.setup()

        await user.click(await screen.findByRole('button', { name: 'Create team and project' }))

        const team = screen.getByLabelText('Team name')
        const message = "The server didn't accept this team name: expected length <= 100."
        expect(await screen.findByText(message)).toBeInTheDocument()
        expect(team).toHaveAttribute('aria-invalid', 'true')
        expect(team).toHaveAccessibleDescription(message)
        expect(screen.getByLabelText('Project name')).not.toHaveAttribute('aria-invalid')
        expect(teams).toBe(1)

        await user.type(team, '!')
        expect(team).not.toHaveAttribute('aria-invalid')
    })

    it('puts a refused project name on the project', async () => {
        await openApp('/', {
            'POST /api/v1/teams/list': none,
            'POST /api/v1/projects/list': none,
            'POST /api/v1/tickets/list': none,
            'POST /api/v1/documents/list': none,
            'POST /api/v1/comments/list': none,
            'POST /api/v1/teams': () => ok(TEAM),
            'POST /api/v1/projects': () =>
                problem(422, 'unprocessable_entity', [{ location: 'body.name', message: 'expected length <= 100' }]),
        })
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const user = userEvent.setup()

        await user.click(await screen.findByRole('button', { name: 'Create team and project' }))

        expect(await screen.findByText("The server didn't accept this project name: expected length <= 100.")).toBeInTheDocument()
        expect(screen.getByLabelText('Project name')).toHaveAttribute('aria-invalid', 'true')
    })
})

describe("the server's refusal, when the client check never ran", () => {
    // Everything above stops the request being made. These go straight to the
    // store, as another tab or an older build would, so the server's answer is
    // what the user meets.
    it('lands a title the server refused on the title field, even one the client would have allowed', async () => {
        // A server whose limit has moved below the one this build knows.
        await openApp('/tickets/t-1', {
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': () =>
                problem(422, 'unprocessable_entity', [
                    { location: 'body.title', message: 'expected length <= 20' },
                ]),
        })
        await screen.findByLabelText('Title')

        await updateTicket('t-1', { title: 'x'.repeat(30) })

        const message = "The server didn't accept this title: expected length <= 20."
        expect(await screen.findByText(message)).toBeInTheDocument()
        expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true')
        expect(screen.getByLabelText('Title')).toHaveAccessibleDescription(message)
    })

    it('says a status that no longer exists is gone, at the status control, and sends again when another is picked', async () => {
        const puts: (string | null)[] = []
        await openApp('/tickets/t-1', {
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': async (request) => {
                const body = await bodyOf(request)
                puts.push(body.status_id)
                if (body.status_id === 's-gone') {
                    return problem(422, 'status_not_found', [
                        { location: 'body.status_id', message: 'status not found' },
                    ])
                }
                return ok(ticket({ ...body, version: 4, updated_by: ME }))
            },
        })
        await screen.findByLabelText('Title')

        await updateTicket('t-1', { status_id: 's-gone' })

        const message = 'That status no longer exists. Pick another.'
        expect(await screen.findByText(message)).toBeInTheDocument()
        expect(screen.getByLabelText('Status')).toHaveAttribute('aria-invalid', 'true')
        expect(screen.getByLabelText('Status')).toHaveAccessibleDescription(message)

        await userEvent.selectOptions(screen.getByLabelText('Status'), 'In Progress')
        await waitFor(() => expect(puts).toEqual(['s-gone', 's-doing']))
        await waitFor(() => expect(sync.outbox).toEqual([]))
        expect(screen.queryByText(message)).not.toBeInTheDocument()
    })

    it('says an assignee that is gone is gone, at the assignee control', async () => {
        await openApp('/tickets/t-1', {
            ...listRoutes([ticket({ version: 3 })]),
            'PUT /api/v1/tickets/t-1': () =>
                problem(422, 'assignee_not_found', [
                    { location: 'body.assignee_id', message: 'assignee not found' },
                ]),
        })
        await screen.findByLabelText('Title')

        await updateTicket('t-1', { assignee_id: 'acc-gone' })

        const message = 'That assignee is no longer available. Pick another.'
        const select = await screen.findByLabelText('Assignee')
        expect(await screen.findByText(message)).toBeInTheDocument()
        expect(select).toHaveAttribute('aria-invalid', 'true')
    })
})
