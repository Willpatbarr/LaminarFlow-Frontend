import {
    connectionIs,
    expect,
    fields,
    newAccount,
    projectOf,
    serverCreate,
    serverTicket,
    signedInAs,
    test,
} from './support/app'

// LAM-95: the team's statuses, edited from team settings. Every assertion about
// "saved" reads the server, not the screen.
test('rename, reorder and delete with a move reach the server, and the list survives a reload', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('statuses')
    const world = await projectOf(account)
    const [todo, doing, done] = world.statusIds
    const [todoName, doingName, doneName] = world.statusNames
    const stuck = await serverCreate(account, world.projectId, fields('Stuck in progress', { status_id: doing }))
    await signedInAs(context, account, baseURL!)

    const serverStatuses = async () => {
        const { data } = await account.api.GET('/api/v1/teams/{id}', { params: { path: { id: world.teamId } } })
        return [...(data?.statuses ?? [])].sort((a, b) => a.position - b.position)
    }
    const names = () =>
        page
            .getByRole('list', { name: 'Status order' })
            .getByRole('textbox')
            .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))

    // Reachable from the ticket list's header.
    await page.goto(`/projects/${world.projectId}`)
    await page.getByRole('link', { name: 'Edit statuses' }).click()
    await expect(page.getByRole('heading', { name: 'Team settings' })).toBeVisible()
    await expect.poll(names).toEqual([todoName, doingName, doneName])
    await connectionIs(page, 'Connected')

    // Rename.
    const field = page.getByLabel(`Name of ${todoName}`)
    await field.fill('Backlog')
    await field.blur()
    await expect.poll(async () => (await serverStatuses()).map((s) => s.name)).toEqual(['Backlog', doingName, doneName])

    // Recolour (LAM-192): the server stores the hue name, and it survives the reload below.
    await page.getByLabel(`Colour of ${doneName}`).selectOption({ label: 'Violet' })
    await expect
        .poll(async () => (await serverStatuses()).find((s) => s.id === done)?.color)
        .toBe('violet')

    // Reorder: the last one up to the top.
    await page.getByRole('button', { name: `Move ${doneName} up` }).click()
    await page.getByRole('button', { name: `Move ${doneName} up` }).click()
    await expect.poll(names).toEqual([doneName, 'Backlog', doingName])
    await expect.poll(async () => (await serverStatuses()).map((s) => s.id)).toEqual([done, todo, doing])

    // Delete a status that a ticket uses: the dialog asks where it goes.
    await page.getByRole('button', { name: `Delete ${doingName}` }).click()
    const dialog = page.getByRole('dialog', { name: new RegExp(`Delete .${doingName}.`) })
    await expect(dialog).toContainText('1 ticket uses this status')
    await dialog.getByLabel('Move tickets to').selectOption({ label: doneName })
    await dialog.getByRole('button', { name: 'Delete status' }).click()

    await expect.poll(names).toEqual([doneName, 'Backlog'])
    await expect.poll(async () => (await serverStatuses()).map((s) => s.id)).toEqual([done, todo])
    await expect.poll(async () => (await serverTicket(account, stuck.id))?.status_id).toBe(done)

    // Add one.
    await page.getByLabel('New status name').fill('Review')
    await page.getByRole('button', { name: 'Add status' }).click()
    await expect.poll(names).toEqual([doneName, 'Backlog', 'Review'])
    await expect.poll(async () => (await serverStatuses()).map((s) => s.name)).toEqual([doneName, 'Backlog', 'Review'])

    // The list survives a reload.
    await page.reload()
    await expect.poll(names).toEqual([doneName, 'Backlog', 'Review'])
    await expect(page.getByLabel(`Colour of ${doneName}`)).toHaveValue('violet')
})
