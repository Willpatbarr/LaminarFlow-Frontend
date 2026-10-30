import AxeBuilder from '@axe-core/playwright'
import type { Page, TestInfo } from '@playwright/test'

import {
    aConflict,
    connectionIs,
    expect,
    fields,
    newAccount,
    openProject,
    openTicket,
    projectOf,
    serverCreate,
    signedInAs,
    test,
} from './support/app'

// An automated scan (axe-core) of each screen, in both colour schemes. It fails
// on serious and critical violations; moderate and minor ones are attached to
// the report so they stay visible without blocking. Axe finds roughly a third of
// what an audit would (missing names, contrast, ARIA misuse) - it does not
// replace using the screens with a keyboard and a screen reader.
//
// Nothing is excluded from the scan. If a rule has to be disabled or a region
// skipped, say why next to the call that does it.

const SCHEMES = ['light', 'dark'] as const

// Axe passes a checkbox whose name comes from a wrapping label, and a link whose
// name is only the text inside it. It does not notice a control that a screen
// reader or an automation tool announces as "on", as a bare symbol, or as
// nothing (LAM-161). This reads the accessibility tree and fails on those.
const NAMED_ROLES = ['link', 'button', 'checkbox', 'radio', 'textbox', 'combobox', 'switch', 'menuitem', 'option', 'tab', 'searchbox', 'spinbutton', 'slider']
const UNNAMED = new RegExp(`^\\s*- (${NAMED_ROLES.join('|')})(?: \\[[^\\]]*\\])*:?\\s*$`)
const BARE_NAME = /^\s*- (?:\w+) "(?:on|off|[^\p{L}\p{N}"]{1,3})"/u

async function everyControlIsNamed(page: Page, name: string, scope = page.locator('body')) {
    const tree = await scope.ariaSnapshot()
    const bad = tree.split('\n').filter((line) => UNNAMED.test(line) || BARE_NAME.test(line))
    expect(bad, `controls with no usable accessible name on ${name}`).toEqual([])
}

async function scan(page: Page, name: string, testInfo: TestInfo) {
    const { violations } = await new AxeBuilder({ page }).analyze()
    const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    const rest = violations.filter((v) => !blocking.includes(v))
    if (rest.length > 0) {
        await testInfo.attach(`axe-non-blocking-${name}`, {
            body: JSON.stringify(rest, null, 2),
            contentType: 'application/json',
        })
    }
    const report = blocking.map((violation) => {
        const where = violation.nodes.map(
            (node) => `    ${node.target.join(' ')}\n      ${node.failureSummary?.replaceAll('\n', '\n      ')}`,
        )
        return `${violation.impact} ${violation.id}: ${violation.help}\n${where.join('\n')}`
    })
    expect(report, `serious or critical accessibility violations on ${name}`).toEqual([])
    await everyControlIsNamed(page, name)
}

for (const scheme of SCHEMES) {
    test.describe(`${scheme} scheme`, () => {
        test.beforeEach(async ({ page }) => {
            // Reduced motion so a transition cannot be caught mid-fade (axe would
            // measure a colour that is on its way to somewhere else).
            await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
        })

        test('the login screen', async ({ page }, testInfo) => {
            await page.goto('/login')
            await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
            await scan(page, `login-${scheme}`, testInfo)
        })

        test('the sign-up screen', async ({ page }, testInfo) => {
            await page.goto('/signup')
            await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
            await scan(page, `signup-${scheme}`, testInfo)
        })

        test('the ticket list and the ticket page', async ({ page, context, baseURL }, testInfo) => {
            const account = await newAccount('axe')
            const world = await projectOf(account)
            const ticket = await serverCreate(
                account,
                world.projectId,
                fields('Scanned ticket', { description: 'Some words.', status_id: world.statusIds[1] }),
            )
            await serverCreate(account, world.projectId, fields('Second ticket'))
            await signedInAs(context, account, baseURL!)

            await openProject(page, world)
            await expect(page.getByRole('link', { name: /Scanned ticket/ })).toBeVisible()
            await connectionIs(page, 'Connected')
            await scan(page, `ticket-list-${scheme}`, testInfo)

            await openTicket(page, ticket.id, 'Scanned ticket')
            await scan(page, `ticket-page-${scheme}`, testInfo)
        })

        async function seeded(context: import('@playwright/test').BrowserContext, baseURL: string) {
            const account = await newAccount('axe')
            const world = await projectOf(account)
            const ticket = await serverCreate(account, world.projectId, fields('Scanned ticket', { description: 'Some words.' }))
            await signedInAs(context, account, baseURL)
            return { account, world, ticket }
        }

        const sideLink = (page: Page, name: string) =>
            page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true })

        test('the board and its column menu', async ({ page, context, baseURL }, testInfo) => {
            const { account, world } = await seeded(context, baseURL!)
            const { data } = await account.api.POST('/api/v1/boards/list', { body: { project_id: world.projectId } })
            await page.goto(`/boards/${data!.items![0].id}`)
            await connectionIs(page, 'Connected')
            await expect(page.getByRole('button', { name: 'Column options for To Do' })).toBeVisible()
            await scan(page, `board-${scheme}`, testInfo)
            await page.getByRole('button', { name: 'Column options for To Do' }).click()
            await expect(page.getByRole('checkbox', { name: 'In Progress' })).toBeVisible()
            await scan(page, `board-column-menu-${scheme}`, testInfo)
        })

        test('the documents list, a document and the review dialog', async ({ page, context, baseURL }, testInfo) => {
            const { account, world } = await seeded(context, baseURL!)
            await newAccount('axe-reviewer')
            // Documents are shared by every account on the server, so the title is unique to this run.
            const title = `Scanned document ${crypto.randomUUID().slice(0, 8)}`
            const made = await account.api.POST('/api/v1/documents', {
                params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
                body: { title, type: 'normal', project_id: world.projectId, body: { content: 'Some words to select.' } },
            })
            expect(made.response.ok).toBe(true)
            await page.goto('/documents')
            await expect(page.getByRole('link', { name: title })).toBeVisible()
            await scan(page, `documents-list-${scheme}`, testInfo)

            await page.goto(`/documents/${made.data!.id}`)
            await expect(page.getByLabel('Document title')).toHaveValue(title)
            await connectionIs(page, 'Connected')
            await scan(page, `document-page-${scheme}`, testInfo)

            await page.getByRole('textbox', { name: 'Document text' }).click({ clickCount: 3 })
            await page.getByRole('button', { name: 'Request review' }).click()
            const dialog = page.getByRole('dialog')
            await expect(dialog.getByRole('checkbox').first()).toBeVisible()
            await scan(page, `request-review-${scheme}`, testInfo)
        })

        test('the epic, sprint and milestone pages', async ({ page, context, baseURL }, testInfo) => {
            const { account, world } = await seeded(context, baseURL!)
            const epic = (await account.api.POST('/api/v1/epics', { body: { project_id: world.projectId, name: 'Scanned epic', description: '' } })).data!
            const sprint = (await account.api.POST('/api/v1/sprints', { body: { project_id: world.projectId, name: 'Scanned sprint' } })).data!
            const milestone = (await account.api.POST('/api/v1/milestones', { body: { project_id: world.projectId, name: 'Scanned milestone', description: '' } })).data!
            await openProject(page, world)
            for (const [area, row, title] of [
                ['Epics', epic, 'Scanned epic'],
                ['Sprints', sprint, 'Scanned sprint'],
                ['Milestones', milestone, 'Scanned milestone'],
            ] as const) {
                await sideLink(page, area).click()
                await expect(page.getByRole('link', { name: title })).toBeVisible()
                await scan(page, `${area.toLowerCase()}-list-${scheme}`, testInfo)
                await page.getByRole('link', { name: title }).click()
                await expect(page.getByRole('heading', { name: title })).toBeVisible()
                await scan(page, `${area.toLowerCase()}-page-${scheme}`, testInfo)
                expect(row.id).toBeTruthy()
            }
        })

        test('team settings and API tokens', async ({ page, context, baseURL }, testInfo) => {
            const { world } = await seeded(context, baseURL!)
            await page.goto(`/teams/${world.teamId}/settings`)
            await expect(page.getByRole('button', { name: 'Add status' })).toBeVisible()
            await scan(page, `team-settings-${scheme}`, testInfo)

            await page.goto('/settings/tokens')
            await page.getByRole('button', { name: 'Create token' }).first().click()
            await expect(page.getByRole('checkbox', { name: /ticket:read/ })).toBeVisible()
            await scan(page, `create-token-${scheme}`, testInfo)
        })

        test('saved views, the New ticket and Save view dialogs and the search palette', async ({ page, context, baseURL }, testInfo) => {
            const { world } = await seeded(context, baseURL!)
            await openProject(page, world)
            await connectionIs(page, 'Connected')

            await page.getByRole('button', { name: 'New ticket' }).click()
            await expect(page.getByRole('checkbox', { name: 'Create more' })).toBeVisible()
            await scan(page, `new-ticket-${scheme}`, testInfo)
            await page.keyboard.press('Escape')

            await page.getByRole('button', { name: 'Save view' }).click()
            await expect(page.getByRole('radio', { name: 'Only me' })).toBeVisible()
            await expect(page.getByRole('radio', { name: 'The team' })).toBeVisible()
            await scan(page, `save-view-${scheme}`, testInfo)
            await page.keyboard.press('Escape')

            await page.keyboard.press('Control+k')
            await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible()
            await scan(page, `search-palette-${scheme}`, testInfo)
            await page.keyboard.press('Escape')

            await sideLink(page, 'Views').click()
            await expect(page.getByRole('heading', { name: 'Views', exact: true })).toBeVisible()
            await scan(page, `views-${scheme}`, testInfo)
        })

        test('the conflict panel', async ({ page, context, baseURL }, testInfo) => {
            await aConflict(page, context, baseURL!)
            await scan(page, `conflict-panel-${scheme}`, testInfo)
        })
    })
}
