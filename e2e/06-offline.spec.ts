import {
    connectionIs,
    expect,
    fields,
    newAccount,
    openProject,
    openTicket,
    projectOf,
    serverCreate,
    serverTicket,
    serverTickets,
    signedInAs,
    test,
} from './support/app'

test('an edit made offline waits, says so, and reaches the server when the network returns', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('offline')
    const world = await projectOf(account)
    const ticket = await serverCreate(account, world.projectId, fields('Before going offline'))
    await signedInAs(context, account, baseURL!)
    await openTicket(page, ticket.id, 'Before going offline')
    await connectionIs(page, 'Connected')

    // Chromium's offline mode stops requests and fires the page's `offline`
    // event, but leaves an already-open WebSocket standing. The indicator is
    // asserted in the test below, where that matters.
    await context.setOffline(true)

    await page.getByLabel('Title').fill('Edited with no network')
    await page.getByLabel('Title').press('Tab')

    // The page keeps the edit and says it is not on the server yet; the rail
    // counts it.
    await expect(page.getByLabel('Title')).toHaveValue('Edited with no network')
    await expect(page.getByRole('main').getByRole('status')).toContainText('Not synced yet')
    await expect(page.getByRole('button', { name: '1 change waiting' })).toBeVisible()
    expect((await serverTicket(account, ticket.id))?.title).toBe('Before going offline')

    await context.setOffline(false)

    await expect(page.getByRole('button', { name: /waiting/ })).toHaveCount(0)
    await expect(page.getByRole('main').getByRole('status')).not.toContainText('Not synced yet')
    await connectionIs(page, 'Connected')
    await expect(page.getByLabel('Title')).toHaveValue('Edited with no network')
    expect((await serverTicket(account, ticket.id))?.title).toBe('Edited with no network')
})

test('a ticket created offline is opened under a temporary id and gets its real one when back online', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('offline-create')
    const world = await projectOf(account)
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)
    await connectionIs(page, 'Connected')

    await context.setOffline(true)
    await page.getByRole('button', { name: 'New ticket' }).click()
    await page.getByRole('dialog', { name: 'New ticket' }).getByLabel('Title').fill('Born offline')
    await page.getByRole('button', { name: 'Create ticket' }).click()

    await expect(page).toHaveURL(/\/tickets\/tmp_/)
    await expect(page.getByLabel('Title')).toHaveValue('Born offline')
    await expect(page.getByRole('button', { name: '1 change waiting' })).toBeVisible()
    expect(await serverTickets(account, world.projectId)).toHaveLength(0)

    await context.setOffline(false)

    // The page is the same page: only the address changes.
    await expect(page).toHaveURL(/\/tickets\/[0-9a-f]{8}-/)
    await expect(page.getByLabel('Title')).toHaveValue('Born offline')
    await expect(page.getByRole('button', { name: /waiting/ })).toHaveCount(0)
    const onServer = await serverTickets(account, world.projectId)
    expect(onServer.map((ticket) => ticket.title)).toEqual(['Born offline'])
    expect(page.url().endsWith(`/tickets/${onServer[0].id}`)).toBe(true)
})

test('going offline flips the indicator to Offline at once, with the socket still standing, and back to Connected on return', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('offline-indicator')
    const world = await projectOf(account)
    const ticket = await serverCreate(account, world.projectId, fields('Watching the indicator'))
    await signedInAs(context, account, baseURL!)
    await openTicket(page, ticket.id, 'Watching the indicator')
    await connectionIs(page, 'Connected')

    // Chromium leaves the open WebSocket standing when the context goes offline,
    // so the socket alone would go on saying "Connected". The browser's `offline`
    // event is what the indicator follows.
    await context.setOffline(true)
    await connectionIs(page, 'Offline')

    await context.setOffline(false)
    await connectionIs(page, 'Connected')
})
