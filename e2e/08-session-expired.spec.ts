import {
    expect,
    expireSession,
    fields,
    newAccount,
    openTicket,
    PASSWORD,
    projectOf,
    serverCreate,
    serverTicket,
    signedInAs,
    test,
} from './support/app'

test('a session that ends mid-edit keeps the page and the text, and signing in from the banner sends the edit', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('expiring')
    const world = await projectOf(account)
    const ticket = await serverCreate(account, world.projectId, fields('Before the session ended'))
    await signedInAs(context, account, baseURL!)
    await openTicket(page, ticket.id, 'Before the session ended')

    await expireSession(context, baseURL!)
    await page.getByLabel('Title').fill('Typed after the session ended')
    await page.getByLabel('Title').press('Tab')

    // In place: no redirect, same URL, same words.
    const banner = page.getByRole('status').filter({ hasText: "You've been signed out." })
    await expect(banner).toBeVisible()
    await expect(page).toHaveURL(`/tickets/${ticket.id}`)
    await expect(page.getByLabel('Title')).toHaveValue('Typed after the session ended')
    await expect(page.getByRole('button', { name: 'Sign in to sync 1 change' })).toBeVisible()
    await expect(page.getByRole('main').getByRole('status')).toContainText('Not synced: sign in again')

    await banner.getByRole('button', { name: 'Sign in' }).click()
    // The email is already filled in, and the password is where focus lands.
    await expect(banner.getByLabel('Email')).toHaveValue(account.email)
    await expect(banner.getByLabel('Password')).toBeFocused()
    await banner.getByLabel('Password').fill(PASSWORD)
    await banner.getByLabel('Password').press('Enter')

    await expect(banner).toHaveCount(0)
    await expect(page).toHaveURL(`/tickets/${ticket.id}`)
    await expect(page.getByLabel('Title')).toHaveValue('Typed after the session ended')
    await expect(page.getByRole('button', { name: /waiting|sign in to sync/i })).toHaveCount(0)

    await account.login()
    expect((await serverTicket(account, ticket.id))?.title).toBe('Typed after the session ended')
})
