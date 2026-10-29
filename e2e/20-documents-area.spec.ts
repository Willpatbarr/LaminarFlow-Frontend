import { expect, newAccount, projectOf, signedInAs, test } from './support/app'

// LAM-97: documents are browsed globally and per project, filtered by project
// and type, and each opens at its own URL, also pasted into a fresh tab.

test('browse, filter and open documents by URL', async ({ page, context, baseURL }) => {
    const account = await newAccount('docs-area')
    const world = await projectOf(account)
    const make = async (title: string, project_id?: string) => {
        const made = await account.api.POST('/api/v1/documents', {
            params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
            body: { title, type: 'normal', body: { content: 'x' }, ...(project_id ? { project_id } : {}) },
        })
        expect(made.response.ok).toBe(true)
        return made.data!.id
    }
    const inProject = await make('Filed in project', world.projectId)
    await make('Loose note')
    await signedInAs(context, account, baseURL!)

    await page.goto('/documents')
    const list = page.getByRole('list', { name: 'Documents' })
    await expect(list.getByRole('link', { name: 'Filed in project' })).toBeVisible()
    await expect(list.getByRole('link', { name: 'Loose note' })).toBeVisible()

    await page.getByLabel('Project').selectOption(world.projectId)
    await expect(list.getByRole('link', { name: 'Filed in project' })).toBeVisible()
    await expect(list.getByRole('link', { name: 'Loose note' })).toHaveCount(0)

    await page.goto(`/projects/${world.projectId}/documents`)
    await expect(list.getByRole('link', { name: 'Filed in project' })).toBeVisible()
    await expect(list.getByRole('link', { name: 'Loose note' })).toHaveCount(0)

    // The document's URL, pasted into a new tab, opens it.
    await list.getByRole('link', { name: 'Filed in project' }).click()
    await expect(page).toHaveURL(new RegExp(`/documents/${inProject}$`))
    const fresh = await context.newPage()
    await fresh.goto(`/documents/${inProject}`)
    await expect(fresh.getByLabel('Title')).toHaveValue('Filed in project')
})
