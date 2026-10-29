import { connectionIs, expect, newAccount, openProject, projectOf, signedInAs, test } from './support/app'

// LAM-133: a new epic, sprint, milestone or saved view is opened under a
// temporary id. Once the create syncs the address carries the real id, and a
// reload still shows the page (and the saved view's label).

test('new epic, sprint, milestone and saved view: no tmp_ in the address after sync, and reload works', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('tmpid')
    const world = await projectOf(account)
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)
    await connectionIs(page, 'Live')
    const nav = page.getByRole('navigation', { name: 'Main' })

    for (const [kind, path, label] of [
        ['sprint', 'sprints', 'Sprint A'],
        ['epic', 'epics', 'Epic A'],
        ['milestone', 'milestones', 'Milestone A'],
    ] as const) {
        await nav.getByRole('link', { name: `${kind[0].toUpperCase()}${kind.slice(1)}s` }).click()
        await page.getByRole('button', { name: `New ${kind}` }).last().click()
        const dialog = page.getByRole('dialog', { name: `New ${kind}` })
        await dialog.getByLabel('Name').fill(label)
        await dialog.getByRole('button', { name: `Create ${kind}` }).click()
        await expect(page.getByRole('heading', { name: label })).toBeVisible()
        await expect(page).toHaveURL(new RegExp(`/${path}/(?!tmp_)[^/?]+$`))
        expect(page.url()).not.toContain('tmp_')

        await page.reload()
        await expect(page.getByRole('heading', { name: label })).toBeVisible()
        await expect(page.getByText('may have been deleted')).toHaveCount(0)
    }

    // A saved view: the address names it by its real id, and the label survives.
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'New ticket' })).toBeEnabled()
    await page.getByRole('button', { name: 'Save view' }).click()
    const save = page.getByRole('dialog', { name: /Save .* view/ })
    await save.getByLabel('Name').fill('Everything')
    await save.getByLabel('The team').check()
    await save.getByRole('button', { name: 'Save view' }).click()
    await expect(page.getByText('Saved view:')).toBeVisible()
    await expect(page).toHaveURL(/view=(?!tmp_)[^&]+/)
    expect(page.url()).not.toContain('tmp_')

    await page.reload()
    await expect(page.getByText('Saved view:')).toContainText('Everything')
    await expect(page.getByText('Saved view:')).toContainText('(team)')
    expect(page.url()).not.toContain('tmp_')
})
