import { connectionIs, expect, fields, newAccount, openProject, projectOf, serverCreate, signedInAs, test } from './support/app'

// LAM-105: a sprint holding tickets from two epics, built from the UI, and a
// ticket with no epic, sprint or milestone that shows up as a normal ticket.
// Every assertion about "saved" reads the server, not the screen.

test('a sprint made in the UI holds tickets from two epics, and a ticket with no parents is ordinary', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('hierarchy')
    const world = await projectOf(account)
    const epic = async (name: string) =>
        (await account.api.POST('/api/v1/epics', { body: { project_id: world.projectId, name, description: '' } })).data!
    const checkout = await epic('Checkout')
    const search = await epic('Search')
    const inEpic = async (title: string, epicId: string) =>
        (await account.api.POST('/api/v1/tickets', { body: { project_id: world.projectId, ...fields(title), epic_id: epicId } })).data!
    const pay = await inEpic('Pay button', checkout.id)
    const query = await inEpic('Query box', search.id)
    const loose = await serverCreate(account, world.projectId, fields('Loose end'))
    await signedInAs(context, account, baseURL!)

    // The pages list what the server has.
    await openProject(page, world)
    await connectionIs(page, 'Live')
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Epics' }).click()
    const epics = page.getByRole('list', { name: 'Epics' })
    await expect(epics.getByRole('link', { name: 'Checkout' })).toBeVisible()
    await expect(epics.getByRole('link', { name: 'Search' })).toBeVisible()

    // Make the sprint from the sprints page.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Sprints' }).click()
    await expect(page.getByRole('heading', { name: 'Sprints' })).toBeVisible()
    await page.getByRole('button', { name: 'New sprint' }).last().click()
    const dialog = page.getByRole('dialog', { name: 'New sprint' })
    await dialog.getByLabel('Name').fill('Sprint 1')
    await dialog.getByLabel('Start date').fill('2026-03-01')
    await dialog.getByLabel('End date').fill('2026-03-14')
    await dialog.getByRole('button', { name: 'Create sprint' }).click()
    await expect(page.getByRole('heading', { name: 'Sprint 1' })).toBeVisible()

    const serverSprints = async () =>
        (await account.api.POST('/api/v1/sprints/list', { body: { project_id: world.projectId } })).data?.items ?? []
    await expect.poll(async () => (await serverSprints()).map((s) => [s.name, s.start_date, s.end_date])).toEqual([
        ['Sprint 1', '2026-03-01', '2026-03-14'],
    ])
    const sprint = (await serverSprints())[0]

    // Add one ticket from each epic through the picker.
    const search_ = page.getByLabel('Search this project’s tickets')
    for (const title of ['Pay button', 'Query box']) {
        await search_.fill(title)
        await page.getByRole('button', { name: `Add ${title} to this sprint` }).click()
        await expect(page.getByRole('button', { name: `Add ${title} to this sprint` })).toHaveCount(0)
    }

    const members = async () =>
        (
            await account.api.POST('/api/v1/tickets/list', {
                body: { filter: { op: 'and', conditions: [{ field: 'sprint', op: 'eq', value: sprint.id }] } },
            })
        ).data?.items?.map((t) => t.id)
    await expect.poll(async () => ((await members()) ?? []).toSorted()).toEqual([pay.id, query.id].toSorted())

    // The sprint page lists both, with their epics, and progress; the loose ticket is not in it.
    const tickets = page.getByRole('heading', { name: 'Tickets' }).locator('..')
    await expect(tickets.getByRole('link', { name: /Pay button/ })).toBeVisible()
    await expect(tickets.getByRole('link', { name: /Query box/ })).toBeVisible()
    await expect.poll(async () => (await page.locator('[data-cell="epic"]').allTextContents()).toSorted()).toEqual([
        'Checkout',
        'Search',
    ])
    await expect(tickets.getByRole('link', { name: /Loose end/ })).toHaveCount(0)
    await expect(page.getByText('0 of 2 tickets done (0%)')).toBeVisible()

    // The ticket with no parents is an ordinary ticket: in the list, and on its
    // page with every parent picker saying None and nothing to complain about.
    await openProject(page, world)
    await expect(page.getByRole('link', { name: /Loose end/ })).toBeVisible()
    await page.goto(`/tickets/${loose.id}`)
    await expect(page.getByLabel('Title')).toHaveValue('Loose end')
    for (const picker of ['Epic', 'Sprint', 'Milestone']) {
        await expect(page.getByLabel(picker)).toHaveValue('')
    }
    await expect(page.getByRole('alert')).toHaveCount(0)

    // And it is in no epic's page.
    await page.goto(`/epics/${checkout.id}`)
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Pay button/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Loose end/ })).toHaveCount(0)
})
