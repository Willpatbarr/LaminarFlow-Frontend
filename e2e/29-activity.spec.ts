import { connectionIs, expect, fields, newAccount, openTicket, projectOf, serverCreate, signedInAs, test } from './support/app'

// LAM-114: the history under the comments on the ticket page. A status change
// made on the page puts a line at the top, worded plainly and with names.

test('changing a status adds a line to the ticket\'s activity', async ({ page, context, baseURL }) => {
    const account = await newAccount('alice')
    const world = await projectOf(account)
    const ticket = await serverCreate(account, world.projectId, fields('Track my changes'))

    await signedInAs(context, account, baseURL!)
    await openTicket(page, ticket.id, 'Track my changes')
    await connectionIs(page, 'Connected')

    const activity = page.getByRole('region', { name: 'Activity' })
    await expect(activity.getByText(/created this ticket/)).toBeVisible()

    await page.getByLabel('Status').selectOption({ label: world.statusNames[1] })
    // The first status a ticket gets has no "from"; either wording names the new status.
    await expect(activity.getByText(new RegExp(`You (moved this from .+ to|set the status to) ${world.statusNames[1]}`))).toBeVisible()
    // Newest first.
    await expect(activity.getByRole('listitem').first()).toContainText(world.statusNames[1])
})
