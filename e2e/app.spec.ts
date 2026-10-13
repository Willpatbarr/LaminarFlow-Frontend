import { expect, test } from '@playwright/test'

// This spec runs against Vite alone, with no backend behind the proxy, so the
// one request the boot sequence makes is answered here. LAM-73 replaces this
// with specs that run against the real stack.
test('an anonymous visitor to / is sent to the login screen', async ({
    page,
}) => {
    await page.route('**/api/v1/auth/me', (route) =>
        route.fulfill({
            status: 401,
            contentType: 'application/problem+json',
            body: JSON.stringify({ status: 401, code: 'unauthorized' }),
        }),
    )

    await page.goto('/')

    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})
