import { screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { connectSyncToSession, wipeLocalData } from '@/sync'
import { deferred, listRoutes, ME, ticket } from '@/sync/testing/harness'
import { bodyOf, ok } from '@/testing/fetch'
import { openApp, startAnonymous } from '@/testing/app'

// The New ticket dialog's keys and "Create more" (LAM-152), through the real
// route tree, store and engine with only `fetch` stubbed.

let disconnect = () => {}

beforeEach(async () => {
    localStorage.clear()
    await startAnonymous()
    disconnect = connectSyncToSession()
})

afterEach(async () => {
    disconnect()
    await wipeLocalData()
    localStorage.clear()
})

async function openDialog(gate?: Promise<unknown>) {
    const created: Record<string, unknown>[] = []
    const history = await openApp('/', {
        ...listRoutes([]),
        'POST /api/v1/tickets': async (request) => {
            const body = await bodyOf(request)
            created.push(body)
            if (gate) await gate
            return ok(ticket({ id: `t-${created.length}`, ...body, version: 1, updated_by: ME }))
        },
    })
    const user = userEvent.setup()
    await waitFor(() => expect(screen.getByRole('button', { name: 'New ticket' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'New ticket' }))
    const dialog = screen.getByRole('dialog', { name: 'New ticket' })
    return { user, dialog, created, history, title: within(dialog).getByLabelText('Title') }
}

describe('keys in the New ticket dialog', () => {
    it('creates from Enter in the title and opens the ticket', async () => {
        const { user, created, history } = await openDialog()
        await user.type(screen.getByLabelText('Title'), 'From the keyboard{Enter}')

        await waitFor(() => expect(created).toHaveLength(1))
        expect(created[0].title).toBe('From the keyboard')
        await waitFor(() => expect(history.get()).toBe('/tickets/t-1'))
        expect(screen.queryByRole('dialog', { name: 'New ticket' })).not.toBeInTheDocument()
    })

    it('keeps Enter in the description as a new line, and creates from Ctrl+Enter or Cmd+Enter there', async () => {
        const { user, dialog, created } = await openDialog()
        await user.type(within(dialog).getByLabelText('Title'), 'Two lines')
        const description = within(dialog).getByLabelText('Description')
        await user.type(description, 'one{Enter}two')
        expect(created).toEqual([])
        expect(description).toHaveValue('one\ntwo')

        await user.keyboard('{Control>}{Enter}{/Control}')
        await waitFor(() => expect(created).toHaveLength(1))
        expect(created[0].description).toBe('one\ntwo')
    })

    it('creates from Cmd+Enter', async () => {
        const { user, dialog, created } = await openDialog()
        await user.type(within(dialog).getByLabelText('Title'), 'Meta')
        await user.click(within(dialog).getByLabelText('Description'))
        await user.keyboard('{Meta>}{Enter}{/Meta}')
        await waitFor(() => expect(created).toHaveLength(1))
    })

    it('does not create from Enter on an empty title', async () => {
        const { user, created, title } = await openDialog()
        await user.click(title)
        await user.keyboard('{Enter}{Control>}{Enter}{/Control}')
        expect(created).toEqual([])
    })

    it('shows the shortcut beside Create, and lists it in the ? sheet', async () => {
        const { user, dialog } = await openDialog()
        const create = within(dialog).getByRole('button', { name: 'Create ticket' })
        expect(create).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter')
        expect(dialog.querySelector('.modal__hint')).toHaveTextContent(/^(⌘|Ctrl\+)Enter$/)

        await user.keyboard('{Escape}')
        await user.keyboard('?')
        const sheet = within(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' }))
        expect(sheet.getByText(/Create the ticket, from any field/)).toBeInTheDocument()
    })

    it('creates once when Enter is pressed twice before the first create finishes', async () => {
        const gate = deferred<void>()
        const { user, created, title, history } = await openDialog(gate.promise)
        await user.type(title, 'Only once{Enter}{Enter}{Enter}')
        await user.keyboard('{Control>}{Enter}{/Control}')
        gate.resolve()

        await waitFor(() => expect(history.get()).toBe('/tickets/t-1'))
        expect(created).toHaveLength(1)
    })
})

describe('Create more', () => {
    it('stays open, clears the words, keeps the status, refocuses the title and says what it made', async () => {
        const { user, dialog, created, history, title } = await openDialog()
        const status = within(dialog).getByLabelText('Status')
        await user.selectOptions(status, 'In Progress')
        await user.click(within(dialog).getByLabelText('Create more'))
        await user.click(title)
        await user.type(title, 'First')
        await user.type(within(dialog).getByLabelText('Description'), 'Some words')
        await user.keyboard('{Control>}{Enter}{/Control}')

        await waitFor(() => expect(created).toHaveLength(1))
        await waitFor(() => expect(title).toHaveValue(''))
        expect(within(dialog).getByLabelText('Description')).toHaveValue('')
        expect(status).toHaveValue('s-doing')
        expect(title).toHaveFocus()
        expect(history.get()).toBe('/')
        expect(within(dialog).getByRole('status')).toHaveTextContent('Created “First”')

        await user.type(title, 'Second{Enter}')
        await waitFor(() => expect(created).toHaveLength(2))
        expect(created[1]).toMatchObject({ title: 'Second', status_id: 's-doing' })

        // The dialog's link opens the latest ticket and closes the dialog.
        expect(within(dialog).getByRole('status')).toHaveTextContent('Created “Second”')
        await user.click(within(dialog).getByRole('button', { name: 'Open ticket' }))
        await waitFor(() => expect(history.get()).toBe('/tickets/t-2'))
        expect(screen.queryByRole('dialog', { name: 'New ticket' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Open ticket' })).not.toBeInTheDocument()
    })

    it('hands the last ticket to a toast when the dialog is closed instead', async () => {
        const { user, dialog, created, title, history } = await openDialog()
        await user.click(within(dialog).getByLabelText('Create more'))
        await user.click(title)
        await user.type(title, 'Left behind{Enter}')
        await waitFor(() => expect(created).toHaveLength(1))
        await within(dialog).findByText(/Created “Left behind”/)
        await user.keyboard('{Escape}')

        expect(screen.queryByRole('dialog', { name: 'New ticket' })).not.toBeInTheDocument()
        const toast = await screen.findByText('Created “Left behind”')
        expect(toast.closest('[role="status"]')).not.toBeNull()
        await user.click(screen.getByRole('button', { name: 'Open ticket' }))
        await waitFor(() => expect(history.get()).toBe('/tickets/t-1'))
    })

    it('is remembered on this device, and off by default', async () => {
        const first = await openDialog()
        const box = within(first.dialog).getByLabelText('Create more')
        expect(box).not.toBeChecked()
        await first.user.click(box)
        expect(localStorage.getItem('lf-create-more')).toBe('on')
        await first.user.keyboard('{Escape}')

        await first.user.click(screen.getByRole('button', { name: 'New ticket' }))
        expect(within(screen.getByRole('dialog', { name: 'New ticket' })).getByLabelText('Create more')).toBeChecked()
    })

    it('offers a status of "No status" and labels it', async () => {
        const { dialog } = await openDialog()
        const options = within(within(dialog).getByLabelText('Status')).getAllByRole('option')
        expect(options.map((o) => o.textContent)).toEqual(['To Do', 'In Progress', 'Done', 'No status (set one later)'])
    })
})
