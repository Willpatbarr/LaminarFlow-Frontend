import { expect, newAccount, openProject, projectOf, signedInAs, test } from './support/app'

// LAM-139: at phone width the sidebar is a drawer behind a menu button, so the
// first screen is the page and not the navigation.
test.use({ viewport: { width: 375, height: 812 } })

test('the page is on the first screen; the drawer opens, navigates and closes; Escape closes it', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('drawer')
    const world = await projectOf(account)
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)

    // Content first: the heading is on screen without scrolling, the top bar
    // names the page, and the menu is shut.
    const heading = page.getByRole('heading', { name: 'Tickets', level: 1 })
    const box = await heading.boundingBox()
    expect(box!.y + box!.height).toBeLessThan(812)
    const topbar = page.locator('.app-shell__topbar')
    await expect(topbar).toContainText('Tickets')
    const menu = page.getByRole('button', { name: 'Menu' })
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('link', { name: 'Documents' })).toBeHidden()

    // Open: everything the rail has is in the drawer, focus is inside it.
    await menu.click()
    await expect(menu).toHaveAttribute('aria-expanded', 'true')
    const drawer = page.locator('.app-shell__drawer')
    await expect(drawer.getByRole('link', { name: 'Documents' })).toBeVisible()
    await expect(drawer.getByRole('link', { name: 'API tokens' })).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Log out' })).toBeVisible()
    await expect(drawer.locator(':focus')).toHaveCount(1)

    // Navigating closes it, lands on the page and puts the page name in the bar.
    await drawer.getByRole('link', { name: 'Documents' }).click()
    await expect(page).toHaveURL(/\/documents$/)
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('link', { name: 'Documents' })).toBeHidden()
    await expect(topbar).toContainText('Documents')

    // Escape closes it and focus goes back to the menu button.
    await menu.click()
    await expect(drawer.getByRole('link', { name: 'Tickets', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await expect(menu).toBeFocused()

    // A tap outside closes it too, and so does the menu button again.
    await menu.click()
    await page.mouse.click(360, 600)
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await menu.click()
    await menu.click()
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
})
