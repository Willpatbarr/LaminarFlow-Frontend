import type { BrowserContext, Page } from '@playwright/test'

import { connectionIs, expect, fields, newAccount, openTicket, projectOf, serverCreate, serverTicket, serverUpdate, signedInAs, test } from './support/app'

// LAM-131 (QA finding B2): a change someone else saves while you are typing in
// a field is a conflict only if it touched a field you changed too. Bob saves
// through the API (his own session); Alice's page stays live throughout.

async function setup(page: Page, context: BrowserContext, baseURL: string) {
    const alice = await newAccount('alice')
    const bob = await newAccount('bob')
    const world = await projectOf(alice)
    const ticket = await serverCreate(alice, world.projectId, fields('Shared ticket', { description: 'Shared body' }))
    await signedInAs(context, alice, baseURL)
    await openTicket(page, ticket.id, 'Shared ticket')
    await connectionIs(page, 'Connected')
    return { alice, bob, ticket }
}

test('typing in the title while Bob saves a new title shows the conflict for the title, and neither text is lost', async ({ page, context, baseURL }) => {
    const { alice, bob, ticket } = await setup(page, context, baseURL!)

    // Alice types and does not leave the field.
    await page.getByLabel('Title').fill('Shared ticket [A edit]')
    await serverUpdate(bob, ticket.id, ticket.version, fields('Shared ticket (B edit)', { description: 'Shared body' }))

    const panel = page.getByRole('region', { name: 'This ticket needs a decision' })
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('Shared ticket [A edit]')
    await expect(panel).toContainText('Shared ticket (B edit)')
    // Bob's title is still the server's; Alice's is still in her field.
    expect((await serverTicket(alice, ticket.id))?.title).toBe('Shared ticket (B edit)')
    await expect(page.getByLabel('Title')).toHaveValue('Shared ticket [A edit]')
})

test('typing in the title while Bob changes the description is no conflict, and both changes are kept', async ({ page, context, baseURL }) => {
    const { alice, bob, ticket } = await setup(page, context, baseURL!)

    await page.getByLabel('Title').fill('Shared ticket [A edit]')
    await serverUpdate(bob, ticket.id, ticket.version, fields('Shared ticket', { description: 'Bob wrote this' }))
    await page.getByLabel('Title').press('Tab')

    await expect
        .poll(async () => {
            const t = await serverTicket(alice, ticket.id)
            return [t?.title, t?.description]
        })
        .toEqual(['Shared ticket [A edit]', 'Bob wrote this'])
    await expect(page.getByRole('region', { name: 'This ticket needs a decision' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /waiting|needs? a decision/ })).toHaveCount(0)
})

test('a solo edit with several autosaves shows no conflict', async ({ page, context, baseURL }) => {
    const { alice, ticket } = await setup(page, context, baseURL!)

    await page.getByLabel('Title').click()
    await page.keyboard.press('End')
    await page.keyboard.type(' one')
    await page.waitForTimeout(1500)
    await page.keyboard.type(' two')
    await page.waitForTimeout(1500)
    await page.keyboard.type(' three')
    await page.getByLabel('Title').press('Tab')

    await expect
        .poll(async () => (await serverTicket(alice, ticket.id))?.title)
        .toBe('Shared ticket one two three')
    await expect(page.getByRole('region', { name: 'This ticket needs a decision' })).toHaveCount(0)
})
