import { expect, newAccount, openProject, projectOf, signedInAs, test } from './support/app'

// LAM-200: the profile opens an account menu, the rail has a Settings button, and /settings
// reaches every setting.

test('profile menu -> Settings -> Team settings', async ({ page, context, baseURL }) => {
    const account = await newAccount('settings-menu')
    const world = await projectOf(account)
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)

    await page.getByRole('button', { name: 'Account menu' }).click()
    const menu = page.getByRole('menu', { name: 'Account menu' })
    await expect(menu.getByRole('menuitem', { name: 'API tokens' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
    await menu.getByRole('menuitem', { name: /^Settings/ }).click()

    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
    await page.getByRole('link', { name: /^Team settings for / }).click()
    await expect(page).toHaveURL(new RegExp(`/teams/${world.teamId}/settings$`))
    await expect(page.getByRole('heading', { name: 'Team settings', level: 1 })).toBeVisible()
})

test('Settings button -> API tokens, and G then S', async ({ page, context, baseURL }) => {
    const account = await newAccount('settings-button')
    const world = await projectOf(account)
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)

    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'API tokens' })).toHaveCount(0)
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
    await page.getByRole('link', { name: 'Manage API tokens' }).click()
    await expect(page.getByRole('heading', { name: 'API tokens', level: 1 })).toBeVisible()

    await page.goto('/')
    await page.keyboard.press('g')
    await page.keyboard.press('s')
    await expect(page).toHaveURL(/\/settings$/)
})
