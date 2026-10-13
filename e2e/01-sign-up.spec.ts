import { PASSWORD, expect, test, unique } from './support/app'

// Every account joins the one shared workspace, so only the first account in a
// brand-new database is asked to set up a team and project. Both outcomes are
// the app working; the spec handles whichever it gets (the files are numbered so
// this one runs first, and meets the first-run form on a fresh stack).
test('signing up lands in the app, and still there after a reload', async ({ page }) => {
    const email = `${unique('signup')}@e2e.test`

    await page.goto('/signup')
    await page.getByLabel('First name').fill('Ada')
    await page.getByLabel('Last name').fill('Lovelace')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByLabel('Confirm password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign up' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('complementary').getByText('Ada Lovelace')).toBeVisible()

    // The loading placeholder has the "Tickets" heading too, so "loaded" is the
    // setup form, or the list with its button no longer disabled.
    const setup = page.getByRole('heading', { name: 'Set up your first team and project' })
    const tickets = page.getByRole('heading', { name: 'Tickets', level: 1 })
    await expect(setup.or(page.getByRole('button', { name: 'New ticket', disabled: false }))).toBeVisible()

    const firstRun = await setup.isVisible()
    // Visible in the report: on a long-lived stack this branch is never taken.
    test.info().annotations.push({
        type: 'first-run setup',
        description: firstRun ? 'shown' : 'not shown (the workspace already has a project)',
    })

    if (firstRun) {
        const projectName = unique('First project')
        await page.getByLabel('Team name').fill(unique('First team'))
        await page.getByLabel('Project name').fill(projectName)
        await page.getByRole('button', { name: 'Create team and project' }).click()

        await expect(tickets).toBeVisible()
        await expect(page.getByText(`No tickets in ${projectName} yet`)).toBeVisible()
    }

    // The session cookie is `__Host-` and `Secure`; this proves the browser
    // kept it on plain http, which a mocked /auth/me could never tell us.
    await page.reload()
    await expect(page.getByRole('complementary').getByText('Ada Lovelace')).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
})

test('a taken email is refused at the email field, with what was typed still there', async ({ page }) => {
    const email = `${unique('taken')}@e2e.test`
    const signUp = async () => {
        await page.goto('/signup')
        await page.getByLabel('First name').fill('Grace')
        await page.getByLabel('Email').fill(email)
        await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
        await page.getByLabel('Confirm password').fill(PASSWORD)
        await page.getByRole('button', { name: 'Sign up' }).click()
    }

    await signUp()
    await expect(page.getByRole('complementary').getByText('Grace')).toBeVisible()
    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(page).toHaveURL(/\/login$/)

    await signUp()
    await expect(page.getByText('An account with this email already exists.')).toBeVisible()
    await expect(page.getByLabel('Email')).toBeFocused()
    await expect(page.getByLabel('Email')).toHaveValue(email)
})
