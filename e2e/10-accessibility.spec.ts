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

        test('the conflict panel', async ({ page, context, baseURL }, testInfo) => {
            await aConflict(page, context, baseURL!)
            await scan(page, `conflict-panel-${scheme}`, testInfo)
        })
    })
}
