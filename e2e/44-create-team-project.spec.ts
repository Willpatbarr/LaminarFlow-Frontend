import { connectionIs, expect, newAccount, openProject, projectOf, signedInAs, test, unique } from './support/app'

// LAM-199: a second team, and a project in it, made from the sidebar after first run. Both
// must be on the server (not only on the screen) and survive a reload.

test('a second team and a project in it are made from the sidebar and survive a reload', async ({ page, context, baseURL }) => {
    const account = await newAccount('newteam')
    const world = await projectOf(account)
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)
    await connectionIs(page, 'Connected')

    const teamName = unique('Growth')
    const projectName = unique('Runtime')
    const rail = page.locator('.side-nav')

    // The team: an empty name is not allowed, Enter creates, and the app opens the new team.
    await rail.getByRole('button', { name: 'New team' }).click()
    const teamDialog = page.getByRole('dialog', { name: 'New team' })
    await expect(teamDialog.getByRole('button', { name: 'Create team' })).toBeDisabled()
    await teamDialog.getByLabel('Name').fill(teamName)
    await teamDialog.getByLabel('Name').press('Enter')
    await expect(teamDialog).toBeHidden()
    await expect(page).toHaveURL(/\/teams\/[^/]+$/)
    const teamUrl = page.url()
    await expect(rail.getByRole('combobox', { name: 'Team' })).toContainText(teamName)

    // The project goes into the team in view, and the button says which.
    await rail.getByRole('button', { name: `New project in ${teamName}` }).click()
    const projectDialog = page.getByRole('dialog', { name: `New project in ${teamName}` })
    await projectDialog.getByLabel('Name').fill(projectName)
    await projectDialog.getByRole('button', { name: 'Create project' }).click()
    await expect(projectDialog).toBeHidden()
    await expect(page).toHaveURL(/\/projects\/[^/]+$/)
    await expect(rail.getByRole('link', { name: projectName })).toBeVisible()

    // On the server, in the right team. Read by id: a list is paged and the workspace is shared.
    const teamId = /\/teams\/([^/]+)$/.exec(teamUrl)![1]
    const projectId = /\/projects\/([^/]+)$/.exec(page.url())![1]
    const team = (await account.api.GET('/api/v1/teams/{id}', { params: { path: { id: teamId } } })).data!
    expect(team.name).toBe(teamName)
    expect(team.statuses).toHaveLength(3)
    const project = (await account.api.GET('/api/v1/projects/{id}', { params: { path: { id: projectId } } })).data!
    expect(project).toMatchObject({ name: projectName, team_id: teamId })

    // A name already taken is shown on the field and the dialog stays.
    await rail.getByRole('button', { name: 'New team' }).click()
    await teamDialog.getByLabel('Name').fill(teamName)
    await teamDialog.getByLabel('Name').press('Enter')
    await expect(teamDialog.getByText(/already exists/)).toBeVisible()
    await teamDialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(teamDialog).toBeHidden()

    // Survives a reload.
    await page.reload()
    await expect(rail.getByRole('combobox', { name: 'Team' })).toContainText(teamName)
    await expect(rail.getByRole('link', { name: projectName })).toBeVisible()
})

test('the actions are there in the collapsed rail, and in the phone drawer', async ({ page, context, baseURL }) => {
    const account = await newAccount('newteamrail')
    const world = await projectOf(account)
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)

    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    const rail = page.locator('.side-nav--collapsed')
    await expect(rail.getByRole('button', { name: 'New team' })).toBeVisible()
    await expect(rail.getByRole('button', { name: /^New project in / })).toBeVisible()
    await rail.getByRole('button', { name: 'New team' }).click()
    await expect(page.getByRole('dialog', { name: 'New team' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.setViewportSize({ width: 375, height: 812 })
    await page.getByRole('button', { name: 'Menu', exact: true }).click()
    const drawer = page.locator('.app-shell__drawer')
    await expect(drawer.getByRole('button', { name: 'New team' })).toBeVisible()
    await expect(drawer.getByRole('button', { name: /^New project in / })).toBeVisible()
})
