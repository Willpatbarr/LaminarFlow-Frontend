import { expect, newAccount, signInThroughForm, test } from './support/app'

test('logging out ends the session, and logging back in returns to the app', async ({ page }) => {
    const account = await newAccount('login')

    await page.goto('/login')
    await signInThroughForm(page, account)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('complementary').getByText(account.displayName)).toBeVisible()

    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

    // Gone for good, not just hidden: the server no longer knows this browser.
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)

    await signInThroughForm(page, account)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('complementary').getByText(account.displayName)).toBeVisible()
})

test('a wrong password is refused on the form and the email stays', async ({ page }) => {
    const account = await newAccount('wrongpw')

    await page.goto('/login')
    await page.getByLabel('Email').fill(account.email)
    await page.getByLabel('Password').fill('not-the-password-0')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByRole('alert')).toHaveText('That email and password do not match.')
    await expect(page.getByLabel('Email')).toHaveValue(account.email)
    await expect(page).toHaveURL(/\/login$/)
})
