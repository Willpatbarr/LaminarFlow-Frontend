import { connectionIs, expect, fields, newAccount, openProject, openTicket, projectOf, serverCreate, serverTicket, signedInAs, test } from './support/app'

// LAM-128: a ticket is assigned to any workspace member from its page; the pick
// survives a reload, is named on the list, and the assignee finds it under
// "Assignee: You" in their own filter.

test('assign a ticket to a second user, reload, and the assignee finds it in their filter', async ({
    page,
    context,
    browser,
    baseURL,
}) => {
    const alice = await newAccount('alice')
    const bob = await newAccount('bob')
    const world = await projectOf(alice)
    const ticket = await serverCreate(alice, world.projectId, fields('Hand me over'))
    await serverCreate(alice, world.projectId, fields('Not for Bob'))

    await signedInAs(context, alice, baseURL!)
    await openTicket(page, ticket.id, 'Hand me over')
    await connectionIs(page, 'Live')

    const picker = page.getByLabel('Assignee')
    await expect(picker).toHaveValue('')
    await picker.selectOption({ label: bob.displayName })

    await expect.poll(async () => (await serverTicket(alice, ticket.id))?.assignee_id).toBe(bob.accountId)
    await page.reload()
    await expect(page.getByLabel('Title')).toHaveValue('Hand me over')
    await expect(page.getByLabel('Assignee')).toHaveValue(bob.accountId)

    // The list names the assignee.
    await openProject(page, world)
    await expect(page.getByRole('img', { name: `Assigned to ${bob.displayName}` })).toBeVisible()

    // Bob finds it under "You".
    const bobContext = await browser.newContext()
    await signedInAs(bobContext, bob, baseURL!)
    const bobPage = await bobContext.newPage()
    await openProject(bobPage, world)
    await expect(bobPage.getByRole('link', { name: /Not for Bob/ })).toBeVisible()
    await bobPage.getByText(/^Filter/).click()
    await bobPage.getByRole('checkbox', { name: 'You' }).check()
    await expect(bobPage.getByRole('link', { name: /Hand me over/ })).toBeVisible()
    await expect(bobPage.getByRole('link', { name: /Not for Bob/ })).toHaveCount(0)

    // Alice's filter lists Bob by name.
    await page.getByText(/^Filter/).click()
    await expect(page.getByRole('checkbox', { name: bob.displayName })).toBeVisible()

    // Unassigning sticks too.
    await openTicket(page, ticket.id, 'Hand me over')
    await page.getByLabel('Assignee').selectOption({ label: 'Unassigned' })
    await expect.poll(async () => (await serverTicket(alice, ticket.id))?.assignee_id).toBeNull()
})
