import {
    expect,
    fields,
    listLoaded,
    newAccount,
    openProject,
    projectOf,
    signedInAs,
    test,
    type Account,
} from './support/app'

// LAM-106: the list's filter, group, sort and column controls. The whole view
// is in the address, so a reload - or the same link in a fresh tab - brings
// back the same list.

async function epicOf(account: Account, projectId: string, name: string) {
    const { data, response } = await account.api.POST('/api/v1/epics', {
        body: { project_id: projectId, name, description: '' },
    })
    if (!data) throw new Error(`creating the epic failed: ${response.status}`)
    return data.id
}

test('filter, group and sort a list, reload, and get the same view back', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('listview')
    const world = await projectOf(account)
    const [todo, doing] = world.statusIds
    const [todoName] = world.statusNames
    const checkout = await epicOf(account, world.projectId, 'Checkout')
    const accounts = await epicOf(account, world.projectId, 'Accounts')

    for (const [title, status_id, epic_id] of [
        ['Pay by card', todo, checkout],
        ['Sign in', doing, accounts],
        ['Refund', todo, checkout],
        ['Archive docs', todo, null],
    ] as const) {
        const created = await account.api.POST('/api/v1/tickets', {
            body: { project_id: world.projectId, ...fields(title, { status_id }), epic_id },
        })
        if (!created.response.ok) throw new Error(`creating ${title} failed: ${created.response.status}`)
    }

    await signedInAs(context, account, baseURL!)
    await openProject(page, world)
    await expect(page.getByRole('link', { name: /Sign in/ })).toBeVisible()

    // Filter to the first status.
    await page.getByText(/^Filter/).click()
    await page.getByRole('checkbox', { name: todoName }).check()
    await expect(page.getByRole('link', { name: /Sign in/ })).toHaveCount(0)

    // Group by epic, sort by title, descending.
    await page.getByLabel('Group by').selectOption({ label: 'Epic' })
    await page.getByLabel('Sort by').selectOption({ label: 'Title' })
    await page.getByRole('button', { name: 'Sort direction: ascending' }).click()

    const titlesIn = (name: string) =>
        page.getByRole('region', { name, exact: true }).getByRole('link').allTextContents()
    const expectView = async (p: typeof page) => {
        await expect(p.getByRole('region', { name: 'Checkout', exact: true })).toBeVisible()
        await expect
            .poll(() => titlesIn('Checkout'))
            .toEqual([expect.stringContaining('Refund'), expect.stringContaining('Pay by card')])
        await expect.poll(() => titlesIn('No epic')).toEqual([expect.stringContaining('Archive docs')])
        await expect(p.getByRole('region', { name: 'Accounts', exact: true })).toHaveCount(0)
        await expect(p.getByLabel('Group by')).toHaveValue('epic')
        await expect(p.getByLabel('Sort by')).toHaveValue('title')
        await expect(p.getByRole('button', { name: 'Sort direction: descending' })).toBeVisible()
    }
    await expectView(page)

    // Fold a group, and pick a column.
    await page.getByRole('button', { name: /^No epic, 1 ticket/ }).click()
    await expect(page.getByRole('region', { name: 'No epic' }).getByRole('link')).toHaveCount(0)
    await page.getByText('Columns').click()
    await page.getByRole('checkbox', { name: 'Epic', exact: true }).check()
    await expect(
        page.getByRole('region', { name: 'Checkout', exact: true }).getByText('Checkout', { exact: true }).first(),
    ).toBeVisible()

    // Nothing personal in the link, and it reproduces the view.
    const url = new URL(page.url())
    expect([...url.searchParams.keys()].sort()).toEqual(['collapsed', 'columns', 'filter', 'group', 'sort'])
    expect(url.search).not.toContain('@')

    await page.reload()
    await listLoaded(page)
    await expect(page.getByLabel('Group by')).toHaveValue('epic')
    await expect(page.getByRole('region', { name: 'Checkout', exact: true })).toBeVisible()
    await expect
        .poll(() => titlesIn('Checkout'))
        .toEqual([expect.stringContaining('Refund'), expect.stringContaining('Pay by card')])
    await expect(page.getByRole('region', { name: 'No epic' }).getByRole('link')).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Accounts', exact: true })).toHaveCount(0)
    expect(new URL(page.url()).search).toBe(url.search)

    // The same link in a fresh tab of the same session.
    const other = await context.newPage()
    await other.goto(url.pathname + url.search)
    await listLoaded(other)
    await expect(other.getByLabel('Sort by')).toHaveValue('title')
    await expect(other.getByRole('region', { name: 'Checkout', exact: true })).toBeVisible()
    await other.close()
})
