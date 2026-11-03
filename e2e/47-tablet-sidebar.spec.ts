import { expect, newAccount, openProject, projectOf, signedInAs, test } from './support/app'

// LAM-218: on a tablet the expanded sidebar floats over the page. It shuts when you
// go somewhere, click away or press Escape, and the rail names its icons on hover/focus.
test.use({ viewport: { width: 1024, height: 768 } })

test('the tablet overlay shuts on navigation, an outside click and Escape; the rail has tooltips', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('tablet-nav')
    const world = await projectOf(account)
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)

    const rail = page.locator('aside.side-nav')
    await expect(rail).toHaveClass(/side-nav--collapsed/)

    // Tooltips: hover and keyboard focus.
    await rail.getByRole('link', { name: 'Documents' }).hover()
    await expect(page.locator('.side-nav__tip')).toHaveText('Documents')
    await rail.getByRole('link', { name: 'Epics' }).focus()
    await expect(page.locator('.side-nav__tip')).toHaveText('Epics')
    await page.keyboard.press('Escape')
    await expect(page.locator('.side-nav__tip')).toHaveCount(0)

    const expand = page.getByRole('button', { name: 'Expand sidebar' })
    const shut = async () => expect(rail).toHaveClass(/side-nav--collapsed/)

    // Navigation.
    await expand.click()
    await expect(rail).not.toHaveClass(/side-nav--collapsed/)
    await rail.getByRole('link', { name: 'Settings' }).click()
    await expect(page).toHaveURL(/\/settings/)
    await shut()

    // Outside click.
    await expand.click()
    await expect(rail).not.toHaveClass(/side-nav--collapsed/)
    await page.locator('main').click({ position: { x: 700, y: 300 } })
    await shut()

    // Escape returns focus to the button that reopens it.
    await expand.click()
    await rail.getByRole('link', { name: 'Documents' }).focus()
    await page.keyboard.press('Escape')
    await shut()
    await expect(expand).toBeFocused()

    // The choice itself was never rewritten by closing.
    expect(await page.evaluate(() => localStorage.getItem('lf-side-nav-collapsed'))).toBe('0')
})

test('expanded and collapsed, the nav links and Create buttons have names', async ({ page, context, baseURL }) => {
    const account = await newAccount('tablet-names')
    const world = await projectOf(account)
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)
    const rail = page.locator('aside.side-nav')
    for (const state of ['collapsed', 'expanded']) {
        if (state === 'expanded') await page.getByRole('button', { name: 'Expand sidebar' }).click()
        for (const el of await rail.locator('nav a[href], nav button').all()) {
            expect((await el.getAttribute('aria-label'))?.trim(), state).toBeTruthy()
        }
    }
})
