import { expect, newAccount, openProject, projectOf, serverTickets, signedInAs, test } from './support/app'

test('a ticket is created and moved to In Progress using only the keyboard', async ({ page, context, baseURL }) => {
    const account = await newAccount('keys')
    const world = await projectOf(account)
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)
    const inProgress = world.statusNames.find((name) => /progress/i.test(name))
    expect(inProgress, 'the project has an In Progress status').toBeTruthy()

    // C opens the new-ticket dialog; typing the title and Enter creates it.
    await page.keyboard.press('c')
    const dialog = page.getByRole('dialog', { name: 'New ticket' })
    await expect(dialog).toBeVisible()
    await page.keyboard.type('Ship the keyboard map')
    await page.keyboard.press('Enter')

    // The new ticket's page opens. S puts focus on the status; typing picks it.
    await expect(page.getByLabel('Title')).toHaveValue('Ship the keyboard map')
    // The page swaps the temporary id for the server's once; wait it out so the
    // status field is not rebuilt under the key press.
    await expect(page).toHaveURL(/\/tickets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    await page.getByLabel('Title').blur()
    await page.keyboard.press('s')
    await expect(page.getByLabel('Status')).toBeFocused()
    await page.keyboard.type(inProgress!)
    await expect(page.getByLabel('Status')).toHaveValue(world.statusIds[world.statusNames.indexOf(inProgress!)])

    await expect
        .poll(async () => (await serverTickets(account, world.projectId)).map((ticket) => [ticket.title, ticket.status_id]))
        .toEqual([['Ship the keyboard map', world.statusIds[world.statusNames.indexOf(inProgress!)]]])
})

test('? lists the shortcuts, G then T goes back to the list, and keys typed into a field do nothing', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('keyhelp')
    const world = await projectOf(account)
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)

    await page.keyboard.press('Shift+?')
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(sheet.getByText('Go to documents')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)

    await page.keyboard.press('g')
    await page.keyboard.press('d')
    await expect(page).toHaveURL(/\/documents$/)
    await page.keyboard.press('g')
    await page.keyboard.press('t')
    await expect(page).toHaveURL(/\/$/)

    await page.keyboard.press('c')
    await page.keyboard.type('gd?')
    await expect(page.getByRole('dialog', { name: 'New ticket' }).getByLabel('Title')).toHaveValue('gd?')
    await expect(page).toHaveURL(/\/$/)
})

test('Create more keeps the dialog open for the next ticket, and Cmd/Ctrl+Enter creates from the description', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('createmore')
    const world = await projectOf(account)
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)

    await page.keyboard.press('c')
    const dialog = page.getByRole('dialog', { name: 'New ticket' })
    await dialog.getByLabel('Status').selectOption({ label: world.statusNames[1] })
    await dialog.getByLabel('Create more').check()
    await dialog.getByLabel('Title').click()
    await page.keyboard.type('First of two')
    await page.keyboard.press('Enter')

    // Still open, cleared, focused, status kept, and said politely.
    await expect(dialog.getByLabel('Title')).toHaveValue('')
    await expect(dialog.getByLabel('Title')).toBeFocused()
    await expect(dialog.getByLabel('Status')).toHaveValue(world.statusIds[1])
    await expect(page.getByRole('status').filter({ hasText: 'Created “First of two”' }).first()).toBeVisible()

    await page.keyboard.type('Second of two')
    await dialog.getByLabel('Description').fill('Plain Enter is a new line')
    await dialog.getByLabel('Description').press('ControlOrMeta+Enter')
    await expect(dialog.getByLabel('Title')).toHaveValue('')

    await expect
        .poll(async () => (await serverTickets(account, world.projectId)).map((t) => [t.title, t.status_id]).sort())
        .toEqual([
            ['First of two', world.statusIds[1]],
            ['Second of two', world.statusIds[1]],
        ])
    await expect(page).toHaveURL(/\/$/)
})
