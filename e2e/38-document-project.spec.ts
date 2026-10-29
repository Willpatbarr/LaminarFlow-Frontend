import { expect, newAccount, projectOf, signedInAs, test } from './support/app'

// LAM-138: a new document made while the list is filtered to a project is in that
// project and shows in its Documents tab; the Project picker on the document page
// makes it team-wide, and the list then labels it as such.

const UUID = /\/documents\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

test('New document from a filtered list lands in that project; the picker makes it team-wide', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('doc-project')
    const world = await projectOf(account)
    await signedInAs(context, account, baseURL!)

    await page.goto('/documents')
    await page.getByLabel('Project').selectOption({ label: world.projectName })
    await page.getByRole('button', { name: 'New document' }).click()
    await expect(page).toHaveURL(UUID)
    const id = page.url().split('/').pop()!
    await expect(page.getByLabel('Project')).toHaveValue(world.projectId)

    await page.getByLabel('Title').fill('Filed here')
    await page.getByLabel('Title').blur()
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()

    const tab = page.getByRole('list', { name: 'Documents' })
    await page.goto(`/projects/${world.projectId}/documents`)
    await expect(tab.getByRole('link', { name: 'Filed here' })).toBeVisible()

    // Team-wide, explicitly, from the document page.
    await tab.getByRole('link', { name: 'Filed here' }).click()
    await page.getByLabel('Project').selectOption({ label: 'No project (team-wide)' })
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
    await expect.poll(async () => (await account.api.GET('/api/v1/documents/{id}', { params: { path: { id } } })).data?.project_id).toBeNull()

    await page.goto('/documents')
    const row = page.getByRole('list', { name: 'Documents' }).getByRole('listitem').filter({ hasText: 'Filed here' })
    await expect(row.getByText('Team-wide')).toBeVisible()
    await page.goto(`/projects/${world.projectId}/documents`)
    await expect(page.getByRole('link', { name: 'Filed here' })).toHaveCount(0)
})
