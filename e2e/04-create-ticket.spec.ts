import { expect, newAccount, openProject, projectOf, serverTickets, signedInAs, test } from './support/app'

test('a new ticket appears under its status, gets its real id, and survives a reload', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('creator')
    const world = await projectOf(account)
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)
    await expect(page.getByText(`No tickets in ${world.projectName} yet`)).toBeVisible()

    await page.getByRole('button', { name: 'New ticket' }).click()
    const dialog = page.getByRole('dialog', { name: 'New ticket' })
    await dialog.getByLabel('Title').fill('Write the release notes')
    await dialog.getByRole('button', { name: 'Create ticket' }).click()

    // The ticket page opens on a temporary id and swaps it for the server's
    // once the create has been answered, without a reload.
    await expect(page.getByLabel('Title')).toHaveValue('Write the release notes')
    await expect(page).toHaveURL(/\/tickets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    const id = page.url().split('/').pop()!

    await expect(page.getByLabel('Status')).toHaveValue(world.statusIds[0])
    // Nothing waiting: neither the page's marker nor the rail's pending line.
    await expect(page.getByRole('button', { name: /waiting|needs? attention|needs? a decision/ })).toHaveCount(0)

    await page.getByRole('link', { name: '← Tickets' }).click()
    const group = page.getByRole('region', { name: world.statusNames[0] })
    await expect(group.getByRole('link', { name: /Write the release notes/ })).toBeVisible()

    // The server has it, under the same id and status the page showed.
    const onServer = await serverTickets(account, world.projectId)
    expect(onServer.map((ticket) => [ticket.id, ticket.title, ticket.status_id])).toEqual([
        [id, 'Write the release notes', world.statusIds[0]],
    ])

    await page.reload()
    await expect(page.getByLabel('Project')).toBeVisible()
    await page.getByLabel('Project').selectOption({ label: world.projectName })
    await expect(
        page.getByRole('region', { name: world.statusNames[0] }).getByRole('link', { name: /Write the release notes/ }),
    ).toBeVisible()
})
