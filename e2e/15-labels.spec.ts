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
    signedInAs,
    test,
} from './support/app'

// LAM-104: a label made inline from the ticket page is applied to it and shows
// as a chip in the list; team settings renames and deletes labels. Every
// assertion about "saved" reads the server, not the screen.

test('a label created inline is applied, reaches the server and shows as a chip in the list', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('labels')
    const world = await projectOf(account)
    const ticket = await serverCreate(account, world.projectId, fields('Needs a label'))
    await signedInAs(context, account, baseURL!)

    const serverLabels = async () => {
        const { data } = await account.api.POST('/api/v1/labels/list', { body: { team_id: world.teamId } })
        return data?.items ?? []
    }

    await openTicket(page, ticket.id, 'Needs a label')
    await connectionIs(page, 'Live')

    await page.getByLabel('New label name').fill('regression')
    await page.getByRole('button', { name: 'Create and apply' }).click()

    // Picked at once, and a chip on the page.
    await expect(page.getByRole('checkbox', { name: 'regression' })).toBeChecked()
    await expect(page.getByRole('list', { name: 'Labels' }).getByText('regression')).toBeVisible()

    // On the server: the label, and the ticket carrying its real id.
    await expect.poll(async () => (await serverLabels()).map((label) => label.name)).toEqual(['regression'])
    const [label] = await serverLabels()
    await expect.poll(async () => (await serverTicket(account, ticket.id))?.label_ids).toEqual([label.id])

    // The chip is on the ticket's row in the list.
    await openProject(page, world)
    const row = page.getByRole('link', { name: /Needs a label/ })
    await expect(row.getByRole('list', { name: 'Labels' }).getByText('regression')).toBeVisible()

    // And it survives a reload.
    await page.reload()
    await expect(page.getByRole('link', { name: /Needs a label/ }).getByText('regression')).toBeVisible()
})

test('team settings renames a label and deletes it, and the ticket loses its chip', async ({ page, context, baseURL }) => {
    const account = await newAccount('labelsettings')
    const world = await projectOf(account)
    const bug = (await account.api.POST('/api/v1/labels', { body: { team_id: world.teamId, name: 'bug', color: '#ef4444' } })).data!
    const ticket = (
        await account.api.POST('/api/v1/tickets', {
            body: { project_id: world.projectId, ...fields('Has a label'), label_ids: [bug.id] },
        })
    ).data!
    await signedInAs(context, account, baseURL!)

    const serverLabels = async () => {
        const { data } = await account.api.POST('/api/v1/labels/list', { body: { team_id: world.teamId } })
        return (data?.items ?? []).map((label) => label.name)
    }

    await page.goto(`/teams/${world.teamId}/settings`)
    await expect(page.getByRole('heading', { name: 'Team settings' })).toBeVisible()
    await connectionIs(page, 'Live')

    const field = page.getByLabel('Name of bug')
    await field.fill('defect')
    await field.blur()
    await expect.poll(serverLabels).toEqual(['defect'])

    await page.getByRole('button', { name: 'Delete defect' }).click()
    const dialog = page.getByRole('dialog', { name: /Delete .defect./ })
    await expect(dialog).toContainText('1 ticket has this label')
    await dialog.getByRole('button', { name: 'Delete label' }).click()

    await expect.poll(serverLabels).toEqual([])
    await expect.poll(async () => (await serverTicket(account, ticket.id))?.label_ids).toEqual([])
})
