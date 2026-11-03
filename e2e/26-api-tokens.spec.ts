import { expect, newAccount, signedInAs, test, unique } from './support/app'

// LAM-101: create an API token with chosen scopes, see its secret once, use it
// as a Bearer credential, then revoke it and watch it stop working.

test('create a token, use it, revoke it', async ({ page, context, baseURL }) => {
    const account = await newAccount('tokens')
    await signedInAs(context, account, baseURL!)
    // Headless CI Chromium refuses clipboard access unless it is granted.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(baseURL!).origin })
    const label = unique('CI key')
    const me = (token: string) =>
        fetch(new URL('/api/v1/auth/me', baseURL!), { headers: { Authorization: `Bearer ${token}` } })

    await page.goto('/settings/tokens')
    await expect(page.getByRole('heading', { name: 'API tokens', level: 1 })).toBeVisible()

    await page.getByRole('button', { name: 'Create token' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Create API token' })
    await dialog.getByLabel('Name').fill(label)
    const create = dialog.getByRole('button', { name: 'Create token' })
    await expect(create).toBeDisabled()
    await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(0)
    await dialog.getByLabel('Tickets and content Read (ticket:read)').check()
    await expect(create).toBeEnabled()

    // Descriptions and the code sit together; account:delete is set apart and needs a second yes.
    await expect(dialog.getByText('Create, edit and archive the same things.')).toBeVisible()
    await dialog.getByText('Dangerous permissions').click()
    await expect(dialog.getByText(/can delete your account, without signing in/)).toBeVisible()
    await dialog.getByLabel('Delete account (account:delete)').check()
    await expect(create).toBeDisabled()
    await dialog.getByLabel('I understand this token could delete my account.').check()
    await expect(create).toBeEnabled()
    await dialog.getByLabel('Delete account (account:delete)').uncheck()
    await expect(create).toBeEnabled()
    await create.click()

    const shown = page.getByRole('dialog', { name: 'Copy your token' })
    await expect(shown.getByText(/You won't see this again\./)).toBeVisible()
    const token = await shown.getByLabel('Token').inputValue()
    expect(token).toMatch(/^lam_/)
    await shown.getByRole('button', { name: 'Copy token' }).click()
    await expect(shown.getByRole('button', { name: 'Copied' })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(token)
    // The button goes back to "Copy token" by itself.
    await expect(shown.getByRole('button', { name: 'Copy token' })).toBeVisible({ timeout: 8_000 })
    await shown.getByRole('button', { name: 'Done' }).click()
    await expect(shown).toHaveCount(0)

    // The secret is gone from the page and from the browser's storage.
    await expect(page.locator('body')).not.toContainText(token)
    const stored = await page.evaluate(
        (secret) => JSON.stringify({ ...localStorage }).includes(secret) || location.href.includes(secret),
        token,
    )
    expect(stored).toBe(false)

    const row = page.getByRole('listitem').filter({ hasText: label })
    await expect(row).toContainText('ticket:read')
    await expect(row).toContainText('Last used Never')

    const used = await me(token)
    expect(used.status).toBe(200)
    expect(((await used.json()) as { via: string }).via).toBe('token')

    await row.getByRole('button', { name: `Revoke ${label}` }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Revoke token' }).click()
    await expect(row).toHaveCount(0)

    expect((await me(token)).status).toBe(401)
})

// When the browser refuses the clipboard, the button must not claim "Copied".
test('a refused copy says so and leaves the token selectable', async ({ page, context, baseURL }) => {
    const account = await newAccount('tokens')
    await signedInAs(context, account, baseURL!)
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: () => Promise.reject(new Error('denied')) },
            configurable: true,
        })
    })
    await page.goto('/settings/tokens')
    await page.getByRole('button', { name: 'Create token' }).click()
    const dialog = page.getByRole('dialog', { name: 'Create API token' })
    await dialog.getByLabel('Name').fill(unique('Refused'))
    await dialog.getByLabel('Tickets and content Read (ticket:read)').check()
    await dialog.getByRole('button', { name: 'Create token' }).click()

    const shown = page.getByRole('dialog', { name: 'Copy your token' })
    await shown.getByRole('button', { name: 'Copy token' }).click()
    await expect(shown.getByText('Could not copy. Select the token and copy it by hand.')).toBeVisible()
    await expect(shown.getByRole('button', { name: 'Copy token' })).toBeVisible()
    await expect(shown.getByRole('button', { name: 'Copied' })).toHaveCount(0)
})
