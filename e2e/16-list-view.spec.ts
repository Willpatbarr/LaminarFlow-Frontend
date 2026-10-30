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

// LAM-155: header, filter panel, sort options, table text and row actions.
test('the list header, filter panel, sort menu and row actions are tidy', async ({ page, context, baseURL }) => {
    const account = await newAccount('listpolish')
    const world = await projectOf(account)
    const [todo, doing] = world.statusIds
    for (const [title, status_id] of [
        ['Pay by card', todo],
        ['Sign in', doing],
    ] as const) {
        const created = await account.api.POST('/api/v1/tickets', {
            body: { project_id: world.projectId, ...fields(title, { status_id }) },
        })
        if (!created.response.ok) throw new Error(`creating ${title} failed: ${created.response.status}`)
    }
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)
    await expect(page.getByRole('link', { name: /Sign in/ })).toBeVisible()

    // One header row: the title, then the view switch, Edit statuses and New ticket, all on one line.
    const title = await page.getByRole('heading', { name: 'Tickets', exact: true }).boundingBox()
    for (const control of [
        page.getByRole('link', { name: 'Board', exact: true }),
        page.getByRole('link', { name: 'Edit statuses' }),
        page.getByRole('button', { name: /^New ticket/ }),
    ]) {
        const box = (await control.boundingBox())!
        expect(Math.abs(box.y + box.height / 2 - (title!.y + title!.height / 2))).toBeLessThan(30)
    }
    // Save view sits in its own row above the list controls, not over the list.
    const save = (await page.getByRole('button', { name: 'Save view' }).boundingBox())!
    const search = (await page.getByPlaceholder('Search').boundingBox())!
    expect(save.y + save.height).toBeLessThanOrEqual(search.y)

    // One column header for both status groups, with an Assignee column.
    await expect(page.locator('.table__header')).toHaveCount(1)
    await expect(page.locator('.table__header')).toContainText('Assignee')

    // "1 ticket", not "1 tickets".
    await expect(page.getByRole('button', { name: /, 1 ticket$/ }).first()).toBeVisible()

    // Row buttons: always there, named, reachable by Tab.
    const archive = page.getByRole('button', { name: 'Archive Pay by card' })
    await expect(archive).toBeVisible()
    await archive.focus()
    await expect(archive).toBeFocused()
    await expect(archive).toHaveAccessibleDescription('Archive ticket')

    // Sort: one "recently updated", no second "Updated".
    const options = await page.getByLabel('Sort by').locator('option').allTextContents()
    expect(options.filter((o) => o === 'Recently updated')).toHaveLength(1)
    expect(options).not.toContain('Updated')

    // The filter panel's columns start at the same height; "Clear filters" appearing leaves the search box alone.
    await page.getByText(/^Filter/).click()
    await expect(page.locator('.list-controls__fieldset')).not.toHaveCount(0)
    // Each column's first option sits the same distance under its legend: no column starts lower than another.
    const offsets = await page.locator('.list-controls__fieldset').evaluateAll((els) =>
        els.map((el) =>
            Math.round(
                el.querySelector('label')!.getBoundingClientRect().top - el.querySelector('legend')!.getBoundingClientRect().top,
            ),
        ),
    )
    expect(new Set(offsets).size).toBe(1)
    const before = (await page.getByPlaceholder('Search').boundingBox())!
    await page.getByRole('checkbox', { name: world.statusNames[0] }).check()
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible()
    const after = (await page.getByPlaceholder('Search').boundingBox())!
    expect(after).toEqual(before)
})
