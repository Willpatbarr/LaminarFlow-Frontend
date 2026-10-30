import { connectionIs, expect, newAccount, projectOf, signedInAs, test, unique } from './support/app'

// LAM-149: a team is renamed from its settings, a project from its page. The sidebar
// follows at once, and a reload keeps both. Every "saved" assertion reads the server.
test('rename the team and a project: the sidebar updates and a reload keeps it', async ({ page, context, baseURL }) => {
    const account = await newAccount('rename')
    const world = await projectOf(account)
    await signedInAs(context, account, baseURL!)

    const serverTeam = async () =>
        (await account.api.GET('/api/v1/teams/{id}', { params: { path: { id: world.teamId } } })).data?.name
    const serverProject = async () =>
        (await account.api.GET('/api/v1/projects/{id}', { params: { path: { id: world.projectId } } })).data?.name
    const nav = page.getByRole('navigation', { name: 'Main' })

    // The team, from its settings.
    const teamName = unique('Renamed team')
    await page.goto(`/teams/${world.teamId}/settings`)
    await connectionIs(page, 'Connected')
    await page.getByLabel('Team name').fill('   ')
    await page.getByRole('button', { name: 'Save name' }).click()
    await expect(page.getByText('A team needs a name.')).toBeVisible()
    await page.getByLabel('Team name').fill(teamName)
    await page.getByRole('button', { name: 'Save name' }).click()
    await expect(page.getByText('Saved.')).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Team' }).locator('option:checked')).toHaveText(teamName)
    await expect.poll(serverTeam).toBe(teamName)

    // The project, from its page.
    const projectName = unique('Renamed project')
    await page.goto(`/projects/${world.projectId}`)
    await page.getByRole('button', { name: 'Rename project' }).click()
    await page.getByLabel('Project name').fill(projectName)
    await page.getByRole('button', { name: 'Save name' }).click()
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible()
    await expect(nav.getByRole('link', { name: projectName })).toBeVisible()
    await expect.poll(serverProject).toBe(projectName)

    // After a reload, from the server's copy.
    await page.reload()
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible()
    await expect(nav.getByRole('link', { name: projectName })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Team' }).locator('option:checked')).toHaveText(teamName)
})

test('a rename made by someone else shows without a reload', async ({ page, context, baseURL }) => {
    const account = await newAccount('rename-live')
    const world = await projectOf(account)
    await signedInAs(context, account, baseURL!)
    await page.goto(`/projects/${world.projectId}`)
    await connectionIs(page, 'Connected')

    const projectName = unique('Elsewhere')
    const { response } = await account.api.PUT('/api/v1/projects/{id}', {
        params: { path: { id: world.projectId } },
        body: { name: projectName },
    })
    expect(response.ok).toBe(true)
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible()
})
