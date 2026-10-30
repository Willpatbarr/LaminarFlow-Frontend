import {
    connectionIs,
    expect,
    fields,
    newAccount,
    openProject,
    projectOf,
    serverCreate,
    serverTicket,
    serverTickets,
    signedInAs,
    test,
} from './support/app'

test('create with C, edit inline, archive and undo, each reaching the server', async ({ page, context, baseURL }) => {
    const account = await newAccount('lifecycle')
    const world = await projectOf(account)
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)
    await connectionIs(page, 'Live')

    // Create: the C key, a title, a description and a status other than the first.
    await page.keyboard.press('c')
    const dialog = page.getByRole('dialog', { name: 'New ticket' })
    await dialog.getByLabel('Title').fill('Plan the launch')
    await dialog.getByLabel('Description').fill('Dates and owners')
    await dialog.getByLabel('Status').selectOption({ label: world.statusNames[1] })
    await dialog.getByRole('button', { name: 'Create ticket' }).click()
    await expect(page).toHaveURL(/\/tickets\/[0-9a-f]{8}-/)
    const id = page.url().split('/').pop()!

    let onServer = await serverTickets(account, world.projectId)
    expect(onServer.map((t) => [t.id, t.title, t.description, t.status_id])).toEqual([
        [id, 'Plan the launch', 'Dates and owners', world.statusIds[1]],
    ])

    // Edit in the list: title and status.
    await page.getByRole('link', { name: '← Tickets' }).click()
    await page.getByRole('button', { name: 'Edit Plan the launch' }).click()
    await page.getByLabel('Title').fill('Plan the launch party')
    await page.getByLabel('Status').selectOption({ label: world.statusNames[0] })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    // The list holds its order while the pointer is in it (LAM-145); the row
    // joins its new status group when the pointer leaves.
    await page.mouse.move(2, 2)
    await page.getByRole('button', { name: 'New ticket' }).focus()
    const group = page.getByRole('region', { name: world.statusNames[0] })
    await expect(group.getByRole('link', { name: /Plan the launch party/ })).toBeVisible()
    await expect.poll(async () => (await serverTicket(account, id))?.title).toBe('Plan the launch party')
    expect((await serverTicket(account, id))?.status_id).toBe(world.statusIds[0])

    // Archive from the row, then undo.
    await page.getByRole('button', { name: 'Archive Plan the launch party' }).click()
    // The archived row is held, dimmed, while the pointer is in the list.
    await page.mouse.move(2, 2)
    await page.getByRole('button', { name: 'New ticket' }).focus()
    await expect(page.getByRole('link', { name: /Plan the launch party/ })).toHaveCount(0)
    await expect.poll(async () => (await serverTickets(account, world.projectId)).length).toBe(0)

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByRole('link', { name: /Plan the launch party/ })).toBeVisible()
    await expect.poll(async () => (await serverTickets(account, world.projectId)).map((t) => t.id)).toEqual([id])
    await expect(page.getByRole('button', { name: /waiting/ })).toHaveCount(0)
})

test('an inline edit and an archive made offline sync when the network returns', async ({ page, context, baseURL }) => {
    const account = await newAccount('offline-list')
    const world = await projectOf(account)
    const keep = await serverCreate(account, world.projectId, fields('Edit while offline', { status_id: world.statusIds[0] }))
    const drop = await serverCreate(account, world.projectId, fields('Archive while offline', { status_id: world.statusIds[0] }))
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)
    await expect(page.getByRole('link', { name: /Edit while offline/ })).toBeVisible()
    await connectionIs(page, 'Live')

    await context.setOffline(true)
    await page.getByRole('button', { name: 'Edit Edit while offline' }).click()
    await page.getByLabel('Title').fill('Edited offline')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('button', { name: 'Archive Archive while offline' }).click()
    await page.mouse.move(2, 2)
    await page.getByRole('button', { name: 'New ticket' }).focus()

    await expect(page.getByRole('link', { name: /Edited offline/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Archive while offline/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '2 changes waiting' })).toBeVisible()
    expect((await serverTicket(account, keep.id))?.title).toBe('Edit while offline')
    expect(await serverTicket(account, drop.id)).not.toBeNull()

    await context.setOffline(false)

    await expect(page.getByRole('button', { name: /waiting/ })).toHaveCount(0)
    expect((await serverTicket(account, keep.id))?.title).toBe('Edited offline')
    expect(await serverTicket(account, drop.id)).toBeNull()
})

test('an undo made offline is queued and restores the ticket on reconnect', async ({ page, context, baseURL }) => {
    const account = await newAccount('offline-undo')
    const world = await projectOf(account)
    const ticket = await serverCreate(account, world.projectId, fields('Undo me offline', { status_id: world.statusIds[0] }))
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)
    await connectionIs(page, 'Live')

    await page.getByRole('button', { name: 'Archive Undo me offline' }).click()
    await expect.poll(async () => await serverTicket(account, ticket.id)).toBeNull()

    await context.setOffline(true)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByRole('link', { name: /Undo me offline/ })).toBeVisible()
    await expect(page.getByRole('button', { name: '1 change waiting' })).toBeVisible()

    await context.setOffline(false)
    await expect(page.getByRole('button', { name: /waiting/ })).toHaveCount(0)
    expect(await serverTicket(account, ticket.id)).not.toBeNull()
})
