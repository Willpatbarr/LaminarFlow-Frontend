import {
    connectionIs,
    expect,
    fields,
    newAccount,
    openProject,
    projectOf,
    serverCreate,
    serverTickets,
    serverUpdate,
    signedInAs,
    test,
} from './support/app'

// LAM-145: with "Recently updated", saving an inline edit used to move that
// row to the top at once, so the next click on the same spot (Archive) hit a
// different ticket. While the pointer is in the list the order now holds.

async function seeded(account: Awaited<ReturnType<typeof newAccount>>, projectId: string, statusId: string) {
    // Created oldest first, so the list (newest change first) reads Third, Second, First.
    const first = await serverCreate(account, projectId, fields('First', { status_id: statusId }))
    const second = await serverCreate(account, projectId, fields('Second', { status_id: statusId }))
    const third = await serverCreate(account, projectId, fields('Third', { status_id: statusId }))
    return { first, second, third }
}

const rowTitles = (page: import('@playwright/test').Page) => page.locator('.table__row .table__text')

test('after an inline edit, Archive at the same spot archives the edited ticket', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('freeze-archive')
    const world = await projectOf(account)
    const { first } = await seeded(account, world.projectId, world.statusIds[0])
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)
    await connectionIs(page, 'Connected')
    await expect(rowTitles(page)).toHaveText(['Third', 'Second', 'First'])

    await page.getByRole('button', { name: 'Edit First' }).click()
    await page.getByLabel('Title').fill('First, renamed')
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    // The renamed row is still last, with its new title.
    await expect(rowTitles(page)).toHaveText(['Third', 'Second', 'First, renamed'])
    const archive = page.getByRole('button', { name: 'Archive First, renamed' })
    const box = (await archive.boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

    await expect
        .poll(async () => (await serverTickets(account, world.projectId)).map((t) => t.title).sort())
        .toEqual(['Second', 'Third'])
    expect((await serverTickets(account, world.projectId)).some((t) => t.id === first.id)).toBe(false)
})

test('the list re-sorts when the pointer leaves it', async ({ page, context, baseURL }) => {
    const account = await newAccount('freeze-thaw')
    const world = await projectOf(account)
    await seeded(account, world.projectId, world.statusIds[0])
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)
    await connectionIs(page, 'Connected')

    await page.getByRole('button', { name: 'Edit First' }).click()
    await page.getByLabel('Title').fill('First, renamed')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(rowTitles(page)).toHaveText(['Third', 'Second', 'First, renamed'])

    await page.mouse.move(2, 2)
    await page.getByRole('button', { name: 'New ticket' }).focus()
    await expect(rowTitles(page)).toHaveText(['First, renamed', 'Third', 'Second'])
})

test('focus in the list freezes it too, for a change made by someone else', async ({ page, context, baseURL }) => {
    const account = await newAccount('freeze-focus')
    const world = await projectOf(account)
    const { first } = await seeded(account, world.projectId, world.statusIds[0])
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)
    await connectionIs(page, 'Connected')
    await page.mouse.move(2, 2)
    await page.getByRole('button', { name: 'New ticket' }).focus()

    // Keyboard focus on a row; the pointer is elsewhere.
    await page.getByRole('link', { name: /Third/ }).focus()
    await serverUpdate(
        account,
        first.id,
        first.version,
        fields('First, by someone else', { status_id: world.statusIds[0] }),
    )
    await expect(page.getByRole('link', { name: /First, by someone else/ })).toBeVisible()
    await expect(rowTitles(page)).toHaveText(['Third', 'Second', 'First, by someone else'])

    // Focus leaves the list: the new order lands.
    await page.getByRole('button', { name: 'New ticket' }).focus()
    await expect(rowTitles(page)).toHaveText(['First, by someone else', 'Third', 'Second'])
})
