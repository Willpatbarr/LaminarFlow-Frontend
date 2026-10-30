import {
    connectionIs,
    expect,
    fields,
    newAccount,
    openProject,
    openTicket,
    projectOf,
    serverCreate,
    signedInAs,
    test,
} from './support/app'

// Two people, two browsers, one real WebSocket. Neither page reloads: a marker
// set on `window` survives only if the document is the one that was loaded.
const NOT_RELOADED = '__lfNotReloaded'

test('an edit in one browser shows up in another account\'s open ticket, live', async ({
    page,
    context,
    browser,
    baseURL,
}) => {
    const alice = await newAccount('alice')
    const bob = await newAccount('bob')
    const world = await projectOf(alice)
    const ticket = await serverCreate(alice, world.projectId, fields('Original title', { description: 'Original body' }))

    await signedInAs(context, alice, baseURL!)
    const bobContext = await browser.newContext()
    await signedInAs(bobContext, bob, baseURL!)
    const bobPage = await bobContext.newPage()

    await openTicket(page, ticket.id, 'Original title')
    await openTicket(bobPage, ticket.id, 'Original title')
    await connectionIs(page, 'Connected')
    await connectionIs(bobPage, 'Connected')
    await page.evaluate((key) => Object.assign(window, { [key]: true }), NOT_RELOADED)

    // Bob renames it; saving is leaving the field.
    await bobPage.getByLabel('Title').fill('Renamed by Bob')
    await bobPage.getByRole('textbox', { name: 'Description' }).fill('Bob was here')
    await bobPage.getByLabel('Title').press('Tab')
    await bobPage.getByRole('textbox', { name: 'Description' }).press('Tab')
    await bobPage.getByLabel('Status').selectOption({ label: world.statusNames[1] })
    await bobPage.getByLabel('Assignee').selectOption({ label: `${bob.displayName} (you)` })

    await expect(page.getByLabel('Title')).toHaveValue('Renamed by Bob')
    await expect(page.getByRole('textbox', { name: 'Description' })).toHaveText('Bob was here')
    await expect(page.getByLabel('Status')).toHaveValue(world.statusIds[1])
    // Alice sees it assigned, though not to her.
    await expect(page.getByLabel('Assignee')).toHaveValue(bob.accountId)

    expect(await page.evaluate((key) => (window as unknown as Record<string, unknown>)[key], NOT_RELOADED)).toBe(true)
    // And nothing of Bob's is waiting on Alice's side: it arrived, it was not sent.
    await expect(page.getByRole('button', { name: /waiting|needs? attention|needs? a decision/ })).toHaveCount(0)
})

test('a ticket created and then archived elsewhere appears in, then leaves, an open list', async ({
    page,
    context,
    browser,
    baseURL,
}) => {
    const alice = await newAccount('alice')
    const bob = await newAccount('bob')
    const world = await projectOf(alice)

    await signedInAs(context, alice, baseURL!)
    const bobContext = await browser.newContext()
    await signedInAs(bobContext, bob, baseURL!)
    const bobPage = await bobContext.newPage()

    await openProject(page, world)
    await openProject(bobPage, world)
    await connectionIs(page, 'Connected')
    await page.evaluate((key) => Object.assign(window, { [key]: true }), NOT_RELOADED)

    await bobPage.getByRole('button', { name: 'New ticket' }).click()
    await bobPage.getByRole('dialog', { name: 'New ticket' }).getByLabel('Title').fill('Made by Bob')
    await bobPage.getByRole('button', { name: 'Create ticket' }).click()

    const row = page.getByRole('region', { name: world.statusNames[0] }).getByRole('link', { name: /Made by Bob/ })
    await expect(row).toBeVisible()

    // Bob is on the ticket page now; archiving takes it from everyone's list.
    await bobPage.getByRole('button', { name: 'Archive ticket' }).click()
    await bobPage.getByRole('dialog').getByRole('button', { name: 'Archive' }).click()

    await expect(row).toHaveCount(0)
    await expect(page.getByText(`No tickets in ${world.projectName} yet`)).toBeVisible()
    expect(await page.evaluate((key) => (window as unknown as Record<string, unknown>)[key], NOT_RELOADED)).toBe(true)
})
