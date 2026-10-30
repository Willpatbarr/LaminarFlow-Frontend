import { expect, newAccount, openProject, projectOf, signedInAs, test } from './support/app'

// LAM-144: Light / Dark / System, stored per device, set before first paint.

const bg = (page: import('@playwright/test').Page) =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor)
const LIGHT = 'rgb(247, 247, 245)'
const DARK = 'rgb(13, 16, 19)'
const CHROME_LIGHT = '#f7f7f5'

test('Light survives a reload with no flash; System follows the OS', async ({ page, context, baseURL }) => {
    const account = await newAccount('theme')
    const world = await projectOf(account)
    await signedInAs(context, account, baseURL!)
    // Record data-theme at the moment the app script starts, to prove it was
    // already set by then.
    await page.addInitScript(() => {
        const w = window as unknown as { __themeAtRoot?: string | null }
        const watch = new MutationObserver(() => {
            if (!document.getElementById('root')) return
            w.__themeAtRoot = document.documentElement.getAttribute('data-theme')
            watch.disconnect()
        })
        watch.observe(document, { childList: true, subtree: true })
    })
    await page.emulateMedia({ colorScheme: 'dark' })
    await openProject(page, world)

    const group = page.getByRole('radiogroup', { name: 'Theme' })
    await expect(group.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true')
    expect(await bg(page)).toBe(DARK)

    await group.getByRole('radio', { name: 'Light' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    expect(await bg(page)).toBe(LIGHT)

    // Reload: still light, and the attribute was there before the app script ran.
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    expect(await page.evaluate(() => (window as unknown as { __themeAtRoot: string | null }).__themeAtRoot)).toBe('light')
    expect(await bg(page)).toBe(LIGHT)
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', CHROME_LIGHT)

    // System: follows emulated OS changes live.
    await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'System' }).click()
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
    expect(await bg(page)).toBe(DARK)
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(() => bg(page)).toBe(LIGHT)
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', CHROME_LIGHT)
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => bg(page)).toBe(DARK)

    // The palette has the commands too.
    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: 'Search' })
    await palette.getByRole('combobox').fill('theme light')
    await palette.getByRole('option', { name: /Theme: Light/ }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})
