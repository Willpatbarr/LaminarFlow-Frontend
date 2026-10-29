import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Status, Ticket, TicketConflict } from '@/sync'

import { ConflictPanel } from './ConflictPanel'
import { RelativeTime } from './RelativeTime'

// The panel on its own, with no store behind it: what it says, from the
// response it is given, and which buttons it offers.

afterEach(() => {
    vi.useRealTimers()
})

const VIEWER = { accountId: 'acc-me', workspaceId: 'ws-1', displayName: 'Ada' }
const STATUSES: Status[] = [
    { id: 's-todo', team_id: 'team-1', name: 'To Do', color: '#94a3b8', position: 1, category: 'not_started', version: 1 },
    { id: 's-done', team_id: 'team-1', name: 'Done', color: '#22c55e', position: 2, category: 'done', version: 1 },
]
const MINE = { title: 'Mine', description: 'My words', status_id: 's-todo', assignee_id: null }

function current(overrides: Partial<Ticket> = {}): Ticket {
    return {
        id: 't-1',
        project_id: 'p-1',
        title: 'Mine',
        description: 'My words',
        status_id: 's-todo',
        assignee_id: null,
        position: 1024,
        version: 5,
        updated_at: '2026-03-10T11:58:00Z',
        updated_by: 'acc-sarah',
        ...overrides,
    }
}

function conflict(overrides: Partial<TicketConflict> = {}): TicketConflict {
    return {
        code: 'ticket_conflict',
        current: current(),
        changed_by: { account_id: 'acc-sarah', display_name: 'Sarah' },
        changed_at: new Date(Date.now() - 2 * 60_000).toISOString(),
        ...overrides,
    }
}

function show(props: Partial<Parameters<typeof ConflictPanel>[0]> = {}) {
    const onKeepTheirs = vi.fn(async () => {})
    const onUseMine = vi.fn(async () => {})
    const onKeepAsNew = vi.fn(async () => {})
    render(() => (
        <ConflictPanel
            kind="update"
            conflict={conflict()}
            mine={MINE}
            statuses={STATUSES}
            viewer={VIEWER}
            onKeepTheirs={onKeepTheirs}
            onUseMine={onUseMine}
            onKeepAsNew={onKeepAsNew}
            {...props}
        />
    ))
    return { onKeepTheirs, onUseMine, onKeepAsNew }
}

describe('the sentence', () => {
    it('names the person and how long ago', () => {
        show()
        expect(screen.getByText(/Sarah edited this ticket/)).toHaveTextContent('Sarah edited this ticket 2 minutes ago.')
    })

    it('says "archived" for an archive', () => {
        show({ conflict: conflict({ code: 'ticket_archived' }) })
        expect(screen.getByText(/archived this ticket/)).toHaveTextContent('Sarah archived this ticket 2 minutes ago.')
    })

    it('does not invent a person when the response names none', () => {
        show({ conflict: conflict({ changed_by: null }) })
        expect(screen.getByText(/This ticket was edited/)).toHaveTextContent('This ticket was edited 2 minutes ago.')
    })

    it('does not invent a person when the response names none, for an archive either', () => {
        show({ conflict: conflict({ changed_by: null, code: 'ticket_archived' }) })
        expect(screen.getByText(/This ticket was archived/)).toHaveTextContent('This ticket was archived 2 minutes ago.')
    })

    it('says "You ... somewhere else" when the other writer is the viewer', () => {
        show({ conflict: conflict({ changed_by: { account_id: 'acc-me', display_name: 'Ada' } }) })
        expect(screen.getByText(/somewhere else/)).toHaveTextContent('You edited this ticket somewhere else 2 minutes ago.')
    })

    it('puts the exact time on the relative one', () => {
        const at = '2026-03-10T11:58:00Z'
        show({ conflict: conflict({ changed_at: at }) })
        const time = screen.getByText(/ago$|just now$|day.* ago$|hours? ago$/, { selector: 'time' })
        expect(time).toHaveAttribute('datetime', at)
        expect(time.getAttribute('title')).toBeTruthy()
        expect(time.getAttribute('title')).not.toBe(time.textContent)
    })

    it('adds that the change is not on the server and is still here', () => {
        show()
        expect(screen.getByText("Your change hasn't been saved to the server. It's still here.")).toBeInTheDocument()
    })
})

describe('the clock', () => {
    it('is looked at again as time passes', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-03-10T12:00:00Z'))
        render(() => <RelativeTime at="2026-03-10T11:58:00Z" />)
        expect(screen.getByText('2 minutes ago')).toBeInTheDocument()

        await vi.advanceTimersByTimeAsync(3 * 60_000)

        expect(screen.getByText('5 minutes ago')).toBeInTheDocument()
    })

    it('stops looking when it leaves the screen', async () => {
        vi.useFakeTimers()
        const view = render(() => <RelativeTime at="2026-03-10T11:58:00Z" />)
        expect(vi.getTimerCount()).toBe(1)
        view.unmount()
        expect(vi.getTimerCount()).toBe(0)
    })
})

describe('what is compared', () => {
    it('lists only the fields that differ, mine beside theirs', () => {
        show({
            conflict: conflict({
                current: current({ title: 'Theirs', status_id: 's-done', assignee_id: 'acc-sarah' }),
            }),
        })
        const fields = within(screen.getByRole('group', { name: 'What differs' }))
        expect(fields.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
            'Title',
            'Status',
            'Assignee',
        ])
        expect(fields.queryByText('Description')).not.toBeInTheDocument()
        expect(fields.getByText('Mine')).toBeInTheDocument()
        expect(fields.getByText('Theirs')).toBeInTheDocument()
        expect(fields.getByText('To Do')).toBeInTheDocument()
        expect(fields.getByText('Done')).toBeInTheDocument()
        // The person who made the change is the one named as the assignee.
        expect(fields.getByText('Unassigned')).toBeInTheDocument()
        expect(fields.getByText('Sarah')).toBeInTheDocument()
        expect(fields.getAllByText('Your version')).toHaveLength(3)
        expect(fields.getAllByText('Their version')).toHaveLength(3)
    })

    it('shows an emptied field as empty, not as nothing', () => {
        show({ conflict: conflict({ current: current({ description: '' }) }) })
        expect(screen.getByText('Empty')).toBeInTheDocument()
        expect(screen.getByText('My words')).toBeInTheDocument()
    })

    it('says so when the two read the same', () => {
        show()
        expect(screen.queryByRole('group', { name: 'What differs' })).not.toBeInTheDocument()
        expect(screen.getByText('Your version and theirs read the same.')).toBeInTheDocument()
    })
})

describe('the way it is marked up', () => {
    it('is a labelled region, not an alert, and none of its buttons is a danger button', () => {
        show({ conflict: conflict({ current: current({ title: 'Theirs' }) }) })
        const region = screen.getByRole('region', { name: 'This ticket needs a decision' })
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        for (const button of within(region).getAllByRole('button')) {
            expect(button.className).not.toContain('danger')
        }
    })

    it('says in one line that editing is paused', () => {
        show()
        expect(screen.getByText(/Editing is paused until you decide/)).toBeInTheDocument()
    })
})

describe('the actions', () => {
    it('offers keep theirs, use mine and keep mine as a new ticket for an edit', () => {
        show()
        expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
            'Keep theirs',
            'Use mine',
            'Keep mine as a new ticket',
        ])
        // The consequence of the one that overwrites is written next to it.
        expect(screen.getByRole('button', { name: 'Use mine' })).toHaveAccessibleDescription(
            'Use mine replaces their change with yours.',
        )
    })

    it('offers no "Use mine" when the ticket was archived', () => {
        show({ conflict: conflict({ code: 'ticket_archived' }) })
        expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
            'Discard my change',
            'Keep mine as a new ticket',
        ])
    })

    it('offers to keep theirs or archive anyway for a collided archive, and nothing to keep', () => {
        show({ kind: 'archive' })
        expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
            'Keep theirs',
            'Archive anyway',
        ])
    })

    it('keeps theirs at once when no words would be lost', async () => {
        const { onKeepTheirs } = show({ conflict: conflict({ current: current({ status_id: 's-done' }) }) })

        await userEvent.setup().click(screen.getByRole('button', { name: 'Keep theirs' }))

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(onKeepTheirs).toHaveBeenCalledOnce()
    })

    it.each([
        ['title', { title: 'Theirs' }, 'Your title is not kept.'],
        ['description', { description: 'Their words' }, 'Your description is not kept.'],
        ['both', { title: 'Theirs', description: 'Their words' }, 'Your title and description are not kept.'],
    ])('asks first when the %s would be lost, and says which', async (_name, theirs, said) => {
        const { onKeepTheirs } = show({ conflict: conflict({ current: current(theirs) }) })
        const user = userEvent.setup()

        const button = screen.getByRole('button', { name: 'Keep theirs' })
        await user.click(button)

        const dialog = screen.getByRole('dialog', { name: 'Set your version aside?' })
        expect(dialog).toHaveTextContent(said)
        expect(onKeepTheirs).not.toHaveBeenCalled()
        // Nothing in the dialog is a danger button, and the safe answer has focus.
        expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
        expect(within(dialog).getByRole('button', { name: 'Keep theirs' }).className).not.toContain('danger')

        await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(onKeepTheirs).not.toHaveBeenCalled()
        expect(button).toHaveFocus()

        await user.click(button)
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep theirs' }))
        expect(onKeepTheirs).toHaveBeenCalledOnce()
    })

    it('asks first before discarding an edit to an archived ticket, using the same words', async () => {
        const { onKeepTheirs } = show({
            conflict: conflict({ code: 'ticket_archived', current: current({ title: 'Theirs' }) }),
        })
        const user = userEvent.setup()

        await user.click(screen.getByRole('button', { name: 'Discard my change' }))
        const dialog = screen.getByRole('dialog')
        await user.click(within(dialog).getByRole('button', { name: 'Discard my change' }))

        expect(onKeepTheirs).toHaveBeenCalledOnce()
    })

    it('runs one action at a time', async () => {
        let finish = () => {}
        const onUseMine = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
        show({ onUseMine })
        const user = userEvent.setup()

        await user.click(screen.getByRole('button', { name: 'Use mine' }))

        for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
        finish()
        await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Use mine' })).toBeEnabled())
        expect(onUseMine).toHaveBeenCalledOnce()
    })
})
