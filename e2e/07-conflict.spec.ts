import { aConflict, expect, serverTicket, serverTickets, test } from './support/app'

// Alice's copy is stale (her live feed was cut), Bob saves first, Alice edits
// and sends: the server answers 409 and the page asks which version stands.
test('a stale edit shows who changed the ticket, and "Keep mine as a new ticket" keeps both', async ({
    page,
    context,
    baseURL,
}) => {
    const { alice, bob, world, ticket, mine, theirs } = await aConflict(page, context, baseURL!)

    const panel = page.getByRole('region', { name: 'This ticket needs a decision' })
    await expect(panel).toContainText(`${bob.displayName} edited this ticket`)
    await expect(panel).toContainText("Your change hasn't been saved to the server. It's still here.")
    // Where the two versions differ, both are on screen.
    await expect(panel).toContainText(mine)
    await expect(panel).toContainText(theirs)
    // Editing is paused until it is decided.
    await expect(page.getByLabel('Title')).toHaveAttribute('readonly', '')
    await expect(page.getByRole('button', { name: '1 change needs a decision' })).toBeVisible()

    await panel.getByRole('button', { name: 'Keep mine as a new ticket' }).click()

    // The page moves on to the copy, which has Alice's words...
    await expect(page.getByRole('region', { name: 'This ticket needs a decision' })).toHaveCount(0)
    await expect(page.getByLabel('Title')).toHaveValue(mine)
    await expect(page).not.toHaveURL(new RegExp(`/tickets/${ticket.id}$`))
    await expect(page.getByText('Saved your version as a new ticket. The original is back to their version.')).toBeVisible()
    await expect(page.getByRole('button', { name: /waiting|needs? a decision/ })).toHaveCount(0)

    // ...and the server holds both: Bob's original untouched, Alice's as a second ticket.
    const onServer = await serverTickets(alice, world.projectId)
    expect(onServer.map((t) => t.title).sort()).toEqual([mine, theirs].sort())
    expect((await serverTicket(alice, ticket.id))?.title).toBe(theirs)
    expect(onServer).toHaveLength(2)

    await page.getByRole('link', { name: '← Tickets' }).click()
    await page.getByLabel('Project').selectOption({ label: world.projectName })
    await expect(page.getByRole('link', { name: new RegExp(mine) })).toBeVisible()
    await expect(page.getByRole('link', { name: new RegExp(theirs) })).toBeVisible()
})

test('"Keep theirs" drops the edit after a confirmation and shows the other person\'s version', async ({
    page,
    context,
    baseURL,
}) => {
    const { alice, world, ticket, theirs } = await aConflict(page, context, baseURL!)
    const panel = page.getByRole('region', { name: 'This ticket needs a decision' })

    await panel.getByRole('button', { name: 'Keep theirs' }).click()

    // Words only Alice had would be lost, so she is asked first.
    const dialog = page.getByRole('dialog', { name: 'Set your version aside?' })
    await expect(dialog).toContainText('Your title is not kept.')
    await dialog.getByRole('button', { name: 'Keep theirs' }).click()

    await expect(panel).toHaveCount(0)
    await expect(page.getByLabel('Title')).toHaveValue(theirs)
    await expect(page.getByLabel('Title')).not.toHaveAttribute('readonly')
    await expect(page.getByText('Kept their version. Your change was discarded.')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/tickets/${ticket.id}$`))
    await expect(page.getByRole('button', { name: /waiting|needs? a decision/ })).toHaveCount(0)

    const onServer = await serverTickets(alice, world.projectId)
    expect(onServer.map((t) => t.title)).toEqual([theirs])
})

test('"Use mine" sends the edit again on the other person\'s version and it wins', async ({
    page,
    context,
    baseURL,
}) => {
    const { alice, ticket, mine } = await aConflict(page, context, baseURL!)
    const panel = page.getByRole('region', { name: 'This ticket needs a decision' })

    await panel.getByRole('button', { name: 'Use mine' }).click()

    await expect(panel).toHaveCount(0)
    await expect(page.getByText('Saved. Your version replaced theirs.')).toBeVisible()
    await expect(page.getByLabel('Title')).toHaveValue(mine)
    await expect(page.getByRole('button', { name: /waiting|needs? a decision/ })).toHaveCount(0)
    expect((await serverTicket(alice, ticket.id))?.title).toBe(mine)
})
