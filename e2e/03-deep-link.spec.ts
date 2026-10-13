import { expect, fields, newAccount, projectOf, serverCreate, signInThroughForm, test } from './support/app'

test('an anonymous deep link to a ticket asks for a login, then returns to that ticket', async ({ page }) => {
    const account = await newAccount('deeplink')
    const world = await projectOf(account)
    const ticket = await serverCreate(account, world.projectId, fields('Reached by a link', { description: 'Body text.' }))

    await page.goto(`/tickets/${ticket.id}`)

    await expect(page).toHaveURL(/\/login\?returnTo=/)
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(`/tickets/${ticket.id}`)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

    await signInThroughForm(page, account)

    await expect(page).toHaveURL(`/tickets/${ticket.id}`)
    await expect(page.getByLabel('Title')).toHaveValue('Reached by a link')
    await expect(page.getByLabel('Description')).toHaveValue('Body text.')
})

test('the way across to sign-up keeps the destination', async ({ page }) => {
    await page.goto('/tickets/00000000-0000-4000-8000-000000000000')
    await expect(page).toHaveURL(/\/login\?returnTo=/)

    await page.getByRole('link', { name: 'Sign up' }).click()

    await expect(page).toHaveURL(/\/signup\?returnTo=%2Ftickets%2F/)
})
