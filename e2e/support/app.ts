import { expect, test as base, type BrowserContext, type Page } from '@playwright/test'

import {
    fields,
    newAccount,
    newWorld,
    PASSWORD,
    serverArchive,
    serverCreate,
    serverTicket,
    serverTickets,
    serverUpdate,
    SESSION_COOKIE,
    unique,
    type Account,
    type World,
} from '../../tests/sync/support/stack'

export {
    expect,
    fields,
    newAccount,
    newWorld,
    PASSWORD,
    serverArchive,
    serverCreate,
    serverTicket,
    serverTickets,
    serverUpdate,
    unique,
}
export type { Account, World }

// A second person on a second device is `browser.newContext()`: its own cookies
// and its own IndexedDB. Playwright applies the config's `use` (baseURL, trace)
// to contexts made that way, so a failure traces both browsers.
export const test = base

/** Lets the browser context act as `account`, with the session cookie the server
 *  gave it - the same cookie signing in through the form would have set. */
export async function signedInAs(context: BrowserContext, account: Account, baseURL: string) {
    const [name, ...rest] = account.cookie().split('=')
    expect(name).toBe(SESSION_COOKIE)
    // domain + path rather than `url`: for a `__Host-` cookie Chromium rejects
    // the url form ("Invalid cookie fields"), and this one is accepted as the
    // host-only, Secure, path=/ cookie the prefix demands.
    await context.addCookies([
        {
            name,
            value: rest.join('='),
            domain: new URL(baseURL).hostname,
            path: '/',
            secure: true,
            httpOnly: true,
            sameSite: 'Strict',
        },
    ])
}

/** A project of the spec's own, plus a second so the project picker is always
 *  there. Every account joins the same workspace, so a spec has to pick its
 *  project out of whatever other specs left; with a picker on every run the
 *  spec does the same thing whether it is the first account in the database or
 *  the hundredth. */
export async function projectOf(owner: Account): Promise<World> {
    const world = await newWorld(owner)
    const decoy = await owner.api.POST('/api/v1/projects', {
        body: { team_id: world.teamId, name: unique('Other project'), bare: false },
    })
    if (!decoy.response.ok) throw new Error(`creating the second project failed: ${decoy.response.status}`)
    return world
}

/** Waits out the first load: the list (or its placeholder, whose button is
 *  disabled) is replaced by the real thing. */
export async function listLoaded(page: Page) {
    await expect(page.getByRole('heading', { name: 'Tickets', level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New ticket' })).toBeEnabled()
}

/** The ticket list, showing this spec's own project. */
export async function openProject(page: Page, world: World) {
    await page.goto('/')
    await listLoaded(page)
    await page.getByLabel('Project').selectOption({ label: world.projectName })
    await expect(page.getByLabel('Project')).toHaveValue(world.projectId)
}

/** A page open on `/tickets/:id` with the ticket loaded. */
export async function openTicket(page: Page, id: string, title: string) {
    await page.goto(`/tickets/${id}`)
    await expect(page.getByLabel('Title')).toHaveValue(title)
}

/** The side nav's connection indicator reads `state`: its live region holds the
 *  state word alone (the drawn label may also say "Syncing N changes", and is
 *  hidden from assistive tech). The rail may be collapsed or in a closed drawer,
 *  so this is attached, not necessarily visible. Scoped to the rail: the top
 *  bar on a phone shows the same word, but outside it. */
export async function connectionIs(
    page: Page,
    state: 'Connected' | 'Offline' | 'Reconnecting' | 'Connecting' | 'Signed out',
) {
    await expect(
        page.getByRole('complementary').getByRole('status').filter({ hasText: new RegExp(`^${state}$`) }),
    ).toBeAttached()
}

/** How many changes are waiting in the page's own outbox (IndexedDB), whatever
 *  the screen says. For "nothing was queued": the pending indicator only
 *  appears once something has been, so its absence proves nothing yet. */
export async function queuedChanges(page: Page): Promise<number> {
    return page.evaluate(
        () =>
            new Promise<number>((resolve, reject) => {
                const open = indexedDB.open('laminarflow')
                open.onerror = () => reject(open.error)
                open.onsuccess = () => {
                    const db = open.result
                    const count = db.transaction('outbox').objectStore('outbox').count()
                    count.onerror = () => reject(count.error)
                    count.onsuccess = () => {
                        db.close()
                        resolve(count.result)
                    }
                }
            }),
    )
}

/** Ends the browser's session on the server without the page knowing, the way
 *  an expiry, a password change or a sign-out in another tab would. */
export async function expireSession(context: BrowserContext, baseURL: string) {
    // No url filter: a Secure cookie does not match an http url in that filter.
    const cookie = (await context.cookies()).find((c) => c.name === SESSION_COOKIE)
    expect(cookie, 'the browser holds a session cookie').toBeDefined()
    const response = await fetch(new URL('/api/v1/auth/logout', baseURL), {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE}=${cookie!.value}` },
    })
    expect(response.ok).toBe(true)
}

/** Signs in through the login form. */
export async function signInThroughForm(page: Page, account: Account) {
    await page.getByLabel('Email').fill(account.email)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
}

/** A WebSocket the test can cut. Install BEFORE the page loads. Everything goes
 *  through to the real server until `cut()`; after that the page's socket is
 *  closed and every reconnect is refused, which is how a ticket's copy on
 *  screen goes stale without the page being offline. (Chromium's offline mode
 *  leaves an open socket standing, so it cannot do this.) */
export async function cuttableSocket(page: Page) {
    const open: { close: () => Promise<void> }[] = []
    let cut = false
    await page.routeWebSocket(/\/api\/v1\/ws$/, async (ws) => {
        if (cut) {
            await ws.close()
            return
        }
        ws.connectToServer()
        open.push(ws)
    })
    return {
        async cut() {
            cut = true
            await Promise.all(open.splice(0).map((ws) => ws.close()))
        },
    }
}

export type Conflict = {
    alice: Account
    bob: Account
    world: World
    ticket: { id: string; version: number }
    /** What Alice typed, and what Bob saved first. */
    mine: string
    theirs: string
}

/** Alice has a ticket open; her live feed is cut; Bob changes the ticket on the
 *  server; Alice, unaware, changes the title too. Ends with her page showing
 *  the conflict panel. */
export async function aConflict(page: Page, context: BrowserContext, baseURL: string): Promise<Conflict> {
    const alice = await newAccount('alice')
    const bob = await newAccount('bob')
    const world = await projectOf(alice)
    const ticket = await serverCreate(alice, world.projectId, fields('Shared ticket', { description: 'Shared body' }))
    const mine = 'Alice changed the title'
    const theirs = 'Bob changed the title'

    await signedInAs(context, alice, baseURL)
    const socket = await cuttableSocket(page)
    await openTicket(page, ticket.id, 'Shared ticket')
    await connectionIs(page, 'Connected')

    await socket.cut()
    await connectionIs(page, 'Reconnecting')
    await serverUpdate(bob, ticket.id, ticket.version, fields(theirs, { description: 'Shared body' }))

    await page.getByLabel('Title').fill(mine)
    await page.getByLabel('Title').press('Tab')

    await expect(page.getByRole('region', { name: 'This ticket needs a decision' })).toBeVisible()
    return { alice, bob, world, ticket, mine, theirs }
}
