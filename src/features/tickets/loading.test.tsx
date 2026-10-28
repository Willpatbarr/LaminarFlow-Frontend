import { createRouter, defineRoutes, memoryHistory } from '@solidjs/router'
import type { JSX } from '@solidjs/web'
import { cleanup, render, screen } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Table } from '@/components/ui/Table'
import { connectSyncToSession, startSync, stopSync, sync, wipeLocalData } from '@/sync'
import { listRoutes, ME, ticket } from '@/sync/testing/harness'
import { openApp } from '@/testing/app'
import { stubFetch } from '@/testing/fetch'

import { TicketDetail } from './components/TicketDetail'
import { TicketList } from './components/TicketList'
import { TicketRow } from './components/TicketRow'
import type { Viewer } from './viewer'

// The loading half of the tickets feature: every container here takes
// `loading` and draws its own placeholder. Each test asserts the same things -
// placeholders and none of the real content, `aria-busy`, one status message -
// and the layout tests assert that the placeholder and the real thing occupy
// the same boxes.

// TicketDetail navigates, so it needs a router around it; the route is a
// catch-all that renders whatever it is given.
function renderInRouter(ui: () => JSX.Element) {
    const Router = createRouter({
        routes: defineRoutes([{ path: '*', component: ui }]),
        history: memoryHistory('/tickets/t-1'),
    })
    return render(() => <Router />)
}

const viewer: Viewer = { accountId: ME, workspaceId: 'ws-1', displayName: 'Ada Lovelace' }

// Loaded content the placeholder must never show.
const TITLE = 'Write the outbox'

afterEach(async () => {
    await stopSync()
    vi.unstubAllGlobals()
})

describe('TicketRow', () => {
    it('loading draws a title bar, a pill and a circle, and no link, title or status', () => {
        const { container } = render(() => (
            <Table columns={['Title', 'Status', '', '']} template="1fr 132px 20px 12px">
                <TicketRow loading />
            </Table>
        ))

        const row = container.querySelector('.table__row') as HTMLElement
        expect(row).toHaveClass('table__row--loading')
        expect(row.tagName).toBe('DIV')
        expect(screen.queryByRole('link')).not.toBeInTheDocument()
        expect(row.querySelectorAll('.skeleton--line')).toHaveLength(1)
        expect(row.querySelectorAll('.skeleton--pill')).toHaveLength(1)
        expect(row.querySelectorAll('.skeleton--circle')).toHaveLength(1)
        expect(row.textContent).toBe('')
        // The whole row is out of the accessibility tree: the list that holds
        // it carries the one announcement.
        expect(row).toHaveAttribute('aria-hidden', 'true')
    })

    it('is the same box as a real row: same classes, same number of cells', () => {
        const { container } = render(() => (
            <Table columns={['Title', 'Status', '', '']} template="1fr 132px 20px 12px">
                <TicketRow loading />
                <TicketRow ticket={ticket()} status={null} statuses={[]} viewer={viewer} />
            </Table>
        ))

        const [placeholder, real] = Array.from(container.querySelectorAll('.table__row'))
        expect(placeholder.parentElement?.className).toBe(real.parentElement?.className)
        expect(placeholder.classList.contains('table__row')).toBe(true)
        expect(placeholder.classList.contains('row')).toBe(true)
        expect(real.classList.contains('row')).toBe(true)
        expect(placeholder.children).toHaveLength(real.children.length)
    })
})

describe('TicketList', () => {
    it('loading draws a group header and rows, keeps the heading, disables the button, and shows nothing real', () => {
        stubFetch({})
        const { container } = render(() => <TicketList viewer={viewer} loading />)
        const section = container.querySelector('section.tickets') as HTMLElement

        expect(section).toHaveAttribute('aria-busy', 'true')
        expect(screen.getByRole('heading', { name: 'Tickets' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'New ticket' })).toBeDisabled()

        // One status, and it says what is loading.
        expect(screen.getAllByRole('status')).toHaveLength(1)
        expect(screen.getByRole('status')).toHaveTextContent('Loading tickets…')

        // Placeholders in the list's own layout: a group header and three rows.
        const group = section.querySelector('.tickets__group') as HTMLElement
        expect(group).toHaveAttribute('aria-hidden', 'true')
        expect(group.querySelector('.tickets__group-title .skeleton--pill')).not.toBeNull()
        expect(group.querySelectorAll('.table__row--loading')).toHaveLength(3)

        // None of the real content.
        expect(screen.queryByRole('link')).not.toBeInTheDocument()
        expect(screen.queryByRole('region')).not.toBeInTheDocument()
        expect(screen.queryByText(/No tickets/)).not.toBeInTheDocument()
        expect(screen.queryByText('To Do')).not.toBeInTheDocument()
    })

    it('shows nothing it should not even when the store already has the tickets', async () => {
        // `loading` is a force: the route passes it while the session is unknown,
        // whatever an earlier session left in the store.
        stubFetch(listRoutes([ticket()]))
        await startSync(ME, { dbName: `loading-force-${Math.random()}` })
        await vi.waitFor(() => expect(sync.hydrated).toBe(true))

        render(() => <TicketList viewer={viewer} loading />)

        expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
        expect(screen.getByRole('status')).toHaveTextContent('Loading tickets…')
    })
})

describe('TicketDetail', () => {
    it('loading draws the form\'s own shape, with no fields, no title and no "not found"', () => {
        stubFetch({})
        const { container } = renderInRouter(() => (
            <TicketDetail id="t-1" viewer={viewer} loading />
        ))
        const section = container.querySelector('section.ticket') as HTMLElement

        expect(section).toHaveAttribute('aria-busy', 'true')
        expect(screen.getByRole('status')).toHaveTextContent('Loading ticket…')
        expect(screen.getAllByRole('status')).toHaveLength(1)

        // The placeholder form: four labelled boxes where the four fields go.
        const form = section.querySelector('.ticket__form') as HTMLElement
        expect(form.tagName).toBe('DIV')
        expect(form).toHaveAttribute('aria-hidden', 'true')
        expect(form.querySelectorAll('.input')).toHaveLength(4)
        expect(form.querySelector('.ticket__row')).not.toBeNull()
        expect(form.querySelector('.ticket__danger .skeleton')).not.toBeNull()

        // Nothing real, and not the miss either. The way back is not a ticket.
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Archive ticket' })).not.toBeInTheDocument()
        expect(screen.queryByRole('heading', { name: 'Ticket not found' })).not.toBeInTheDocument()
        expect(screen.queryByRole('link', { name: /Write/ })).not.toBeInTheDocument()
    })

    it('is the same box as the loaded form: same wrapper, same fields in the same places', async () => {
        stubFetch(listRoutes([ticket()]))
        await startSync(ME, { dbName: `loading-shape-${Math.random()}` })
        await vi.waitFor(() => expect(sync.hydrated).toBe(true))
        const placeholder = renderInRouter(() => (
            <TicketDetail id="t-1" viewer={viewer} loading />
        ))
        const loadingForm = placeholder.container.querySelector('.ticket__form') as HTMLElement
        placeholder.unmount()

        const real = renderInRouter(() => <TicketDetail id="t-1" viewer={viewer} />)
        await real.findByLabelText('Title')
        const realForm = real.container.querySelector('.ticket__form') as HTMLElement

        const shape = (form: HTMLElement) =>
            Array.from(form.children).map((child) => child.className.split(' ')[0])
        // Same wrapper class, the same sequence of blocks (status line, fields,
        // the status/assignee row, hint, danger zone).
        expect(loadingForm.className).toBe(realForm.className)
        expect(shape(loadingForm)).toEqual(
            shape(realForm).filter((name) => name !== 'ticket__failure'),
        )
        expect(loadingForm.querySelectorAll('.input')).toHaveLength(
            realForm.querySelectorAll('.input').length,
        )
    })
})

describe('a warm database', () => {
    let disconnect = () => {}
    beforeEach(() => {
        disconnect = connectSyncToSession()
    })
    afterEach(async () => {
        disconnect()
        await wipeLocalData()
    })

    // What is on screen, frame by frame, as a letter: B for the placeholder,
    // R for real rows. A reload that flashed a skeleton over data it already
    // had would read R...B; one that showed a blank frame would show a gap.
    function watchFrames() {
        const frames: string[] = []
        const look = () => {
            const main = document.querySelector('main')
            if (!main) return
            const frame = main.querySelector('[aria-busy="true"]')
                ? 'B'
                : main.querySelector('.table__row')
                  ? 'R'
                  : '-'
            if (frames.at(-1) !== frame) frames.push(frame)
        }
        const observer = new MutationObserver(look)
        observer.observe(document.body, { subtree: true, childList: true, attributes: true })
        look()
        return { frames, stop: () => observer.disconnect() }
    }

    it('shows its rows from disk with the server still silent, and never goes back to the placeholder', async () => {
        // A first visit leaves the tickets on disk.
        await openApp('/', listRoutes([ticket()]))
        await screen.findByRole('link', { name: /Write the outbox/ })
        cleanup()
        disconnect()
        await stopSync()

        // The reload: same database, and a server that never answers a list.
        disconnect = connectSyncToSession()
        const silent = () => new Promise<Response>(() => {})
        const watch = watchFrames()
        await openApp('/', {
            'POST /api/v1/teams/list': silent,
            'POST /api/v1/projects/list': silent,
            'POST /api/v1/tickets/list': silent,
            'POST /api/v1/documents/list': silent,
        })

        expect(await screen.findByRole('link', { name: /Write the outbox/ })).toBeInTheDocument()
        await new Promise((resolve) => setTimeout(resolve, 20))
        watch.stop()

        // Placeholder while the database is read (a few milliseconds, and the
        // same placeholder the unknown session drew), then the rows - and no
        // frame in between with neither, and none after.
        expect(watch.frames.join('')).toMatch(/^B?R$/)
        expect(screen.getByRole('main').querySelector('[aria-busy="true"]')).toBeNull()
        expect(screen.queryByRole('status', { name: /Loading/ })).not.toBeInTheDocument()
    })

    it('a warm ticket page shows the form without waiting for the server', async () => {
        await openApp('/tickets/t-1', listRoutes([ticket()]))
        await screen.findByLabelText('Title')
        cleanup()
        disconnect()
        await stopSync()

        disconnect = connectSyncToSession()
        const silent = () => new Promise<Response>(() => {})
        await openApp('/tickets/t-1', {
            'POST /api/v1/teams/list': silent,
            'POST /api/v1/projects/list': silent,
            'POST /api/v1/tickets/list': silent,
            'POST /api/v1/documents/list': silent,
        })

        expect(await screen.findByLabelText('Title')).toHaveValue('Write the outbox')
        expect(screen.queryByRole('heading', { name: 'Ticket not found' })).not.toBeInTheDocument()
    })
})
