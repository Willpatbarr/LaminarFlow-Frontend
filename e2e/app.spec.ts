import { expect, test } from '@playwright/test'

test('the shell renders and / resolves to the tickets screen', async ({
                                                                          page,
                                                                      }) => {
    await page.goto('/')

    await expect(page.getByRole('link', { name: 'LaminarFlow' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Tickets' })).toBeVisible()
})