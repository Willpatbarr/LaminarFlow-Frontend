import { screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { connectSyncToSession, wipeLocalData } from '@/sync'
import { listRoutes, ME, ticket } from '@/sync/testing/harness'
import { ME_BODY, openApp, startAnonymous } from '@/testing/app'
import { ALL_PERMISSIONS } from '@/testing/permissions'

import { CHORD_MS, keysOf, SHORTCUTS } from '.'

// The keyboard shortcuts (LAM-124) through the real route tree, with only
// `fetch` stubbed.

let disconnect = () => {}

beforeEach(async () => {
    await startAnonymous()
    disconnect = connectSyncToSession()
})

afterEach(async () => {
    vi.useRealTimers()
    disconnect()
    await wipeLocalData()
    vi.unstubAllGlobals()
})

const READ_ONLY = { ...ME_BODY, account_id: ME, permissions: ALL_PERMISSIONS.filter((p) => p !== 'ticket:write') }

async function list(me: object = ME_BODY) {
    const history = await openApp('/', listRoutes([ticket({ id: 't-1', title: 'One' }), ticket({ id: 't-2', title: 'Two' })]), me)
    const user = userEvent.setup()
    await screen.findByRole('link', { name: /One/ })
    await screen.findByRole('button', { name: /New ticket/ })
    return { history, user }
}

describe('navigation', () => {
    it('G then D goes to documents, G then T back to tickets', async () => {
        const { history, user } = await list()
        await user.keyboard('gd')
        await waitFor(() => expect(history.get()).toBe('/documents'))
        await user.keyboard('gt')
        await waitFor(() => expect(history.get()).toBe('/'))
    })

    it('forgets a G left waiting for a second', async () => {
        const { history, user } = await list()
        vi.useFakeTimers({ shouldAdvanceTime: true })
        await user.keyboard('g')
        await vi.advanceTimersByTimeAsync(CHORD_MS + 50)
        await user.keyboard('d')
        expect(history.get()).toBe('/')
    })
})

describe('where they do not fire', () => {
    it('ignores keys typed into a field, a modifier chord, and a key while a dialog is open', async () => {
        const { history, user } = await list()
        await user.keyboard('{Control>}g{/Control}d')
        await user.keyboard('{Alt>}g{/Alt}d')
        expect(history.get()).toBe('/')

        await user.keyboard('c')
        const dialog = await screen.findByRole('dialog', { name: 'New ticket' })
        await user.type(within(dialog).getByLabelText('Title'), 'gd?c')
        expect(within(dialog).getByLabelText('Title')).toHaveValue('gd?c')
        expect(history.get()).toBe('/')
        expect(screen.getAllByRole('dialog')).toHaveLength(1)
        // Focus on the dialog itself rather than a field: still not the page's keys.
        within(dialog).getByRole('button', { name: 'Cancel' }).focus()
        await user.keyboard('gd?')
        expect(history.get()).toBe('/')
        expect(screen.getAllByRole('dialog')).toHaveLength(1)
    })

    it('ignores a key typed into a contenteditable', async () => {
        const { history, user } = await list()
        const editable = document.createElement('div')
        editable.setAttribute('contenteditable', 'true')
        editable.tabIndex = 0
        document.body.append(editable)
        editable.focus()
        await user.keyboard('gd?')
        expect(history.get()).toBe('/')
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        editable.remove()
    })
})

describe('the list', () => {
    it('J and K move focus through the rows', async () => {
        const { user } = await list()
        await user.keyboard('j')
        expect(screen.getByRole('link', { name: /One/ })).toHaveFocus()
        await user.keyboard('j')
        expect(screen.getByRole('link', { name: /Two/ })).toHaveFocus()
        await user.keyboard('k')
        expect(screen.getByRole('link', { name: /One/ })).toHaveFocus()
    })

    it('does not offer C to an account that cannot write', async () => {
        const { user } = await list(READ_ONLY)
        await user.keyboard('c')
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
})

describe('a ticket', () => {
    it('S puts focus on the status, E in the title', async () => {
        await openApp('/tickets/t-1', listRoutes([ticket({ id: 't-1', title: 'One' })]))
        const user = userEvent.setup()
        await screen.findByDisplayValue('One')
        await user.keyboard('s')
        expect(screen.getByLabelText('Status')).toHaveFocus()
        await user.keyboard('{Escape}')
        ;(document.activeElement as HTMLElement).blur()
        await user.keyboard('e')
        expect(screen.getByLabelText('Title')).toHaveFocus()
        expect(screen.getByLabelText('Title')).toHaveValue('One')
    })
})

describe('the help sheet', () => {
    it('opens on ? and lists the list screen keys, then closes on Escape', async () => {
        const { user } = await list()
        await user.keyboard('?')
        const sheet = within(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' }))
        expect(sheet.getByText('Next ticket')).toBeInTheDocument()
        expect(sheet.getByText('New ticket')).toBeInTheDocument()
        expect(sheet.getByText('Go to documents')).toBeInTheDocument()
        // Not on this screen.
        expect(sheet.queryByText('Change status')).not.toBeInTheDocument()
        await user.keyboard('{Escape}')
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('leaves out what the account cannot do', async () => {
        const { user } = await list(READ_ONLY)
        await user.keyboard('?')
        const sheet = within(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' }))
        expect(sheet.queryByText('New ticket')).not.toBeInTheDocument()
        expect(sheet.getByText('Go to documents')).toBeInTheDocument()
    })

    it('lists, on the ticket screen, the keys of that screen', async () => {
        await openApp('/tickets/t-1', listRoutes([ticket({ id: 't-1', title: 'One' })]))
        const user = userEvent.setup()
        await screen.findByDisplayValue('One')
        await user.keyboard('?')
        const sheet = within(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' }))
        expect(sheet.getByText('Change status')).toBeInTheDocument()
        expect(sheet.queryByText('Next ticket')).not.toBeInTheDocument()
    })
})

describe('the registry', () => {
    it('has no two shortcuts on the same keys in the same scope, and writes keys for people', () => {
        const seen = new Set<string>()
        for (const def of SHORTCUTS) {
            const key = `${def.scope}:${def.keys}`
            expect(seen.has(key)).toBe(false)
            seen.add(key)
        }
        expect(keysOf('nav.tickets')).toBe('G then T')
        expect(keysOf('help.open')).toBe('?')
    })

    it('uses no key the browser reserves', () => {
        for (const def of SHORTCUTS) {
            expect(def.keys).not.toMatch(/^mod\+[tnwlrqdfp]$/)
        }
    })
})
