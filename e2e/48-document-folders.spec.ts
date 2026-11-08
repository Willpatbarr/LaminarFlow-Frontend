import { expect, newAccount, projectOf, signedInAs, test } from './support/app'

// Document folders: made on a project's Documents tab, a document dragged into one,
// a folder moved inside another from its menu, and a delete that keeps everything
// it held, one level up - on screen and on the server.

test('folders hold a project\'s documents, and deleting one loses nothing', async ({ page, context, baseURL }) => {
    const account = await newAccount('doc-folders')
    const world = await projectOf(account)
    const made = await account.api.POST('/api/v1/documents', {
        body: { title: 'Roadmap', type: 'normal', project_id: world.projectId, body: { content: 'Q1' } },
    })
    const docId = made.data!.id
    await signedInAs(context, account, baseURL!)

    await page.goto(`/projects/${world.projectId}/documents`)
    const list = page.getByRole('list', { name: 'Documents' })
    await expect(list.getByRole('link', { name: 'Roadmap' })).toBeVisible()

    for (const name of ['Specs', 'Archive']) {
        await page.getByRole('button', { name: 'New folder' }).click()
        const dialog = page.getByRole('dialog', { name: 'New folder' })
        await dialog.getByLabel('Name').fill(name)
        await dialog.getByRole('button', { name: 'Create folder' }).click()
        await expect(list.getByRole('button', { name, exact: true })).toBeVisible()
    }

    // Drag the document onto Specs.
    const row = list.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Roadmap' }) })
    await row.dragTo(list.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Specs', exact: true }) }))
    const inSpecs = page.getByRole('group', { name: 'In Specs' })
    await expect(inSpecs.getByRole('link', { name: 'Roadmap' })).toBeVisible()

    const folders = async () =>
        (await account.api.POST('/api/v1/document-folders/list', { body: { project_id: world.projectId } })).data?.items ?? []
    const folderId = async (name: string) => (await folders()).find((folder) => folder.name === name)?.id
    const serverFolderOf = async () =>
        (await account.api.GET('/api/v1/documents/{id}', { params: { path: { id: docId } } })).data?.folder_id
    await expect.poll(serverFolderOf).toBe(await folderId('Specs'))

    // Move Specs inside Archive from its menu.
    await list.getByRole('button', { name: 'Actions for folder Specs' }).click()
    await page.getByRole('menuitem', { name: 'Move to…' }).click()
    const move = page.getByRole('dialog', { name: 'Move “Specs”' })
    await move.getByLabel('Move to').selectOption({ label: 'Archive' })
    await move.getByRole('button', { name: 'Move' }).click()
    await expect(page.getByRole('group', { name: 'In Archive' }).getByRole('button', { name: 'Specs', exact: true })).toBeVisible()
    await expect.poll(async () => (await folders()).find((folder) => folder.name === 'Specs')?.parent_id).toBe(await folderId('Archive'))

    // A reload keeps the tree, and which folders are open.
    await page.reload()
    await expect(page.getByRole('group', { name: 'In Specs' }).getByRole('link', { name: 'Roadmap' })).toBeVisible()

    // Deleting Specs puts Roadmap in Archive, where Specs was.
    await list.getByRole('button', { name: 'Actions for folder Specs' }).click()
    await page.getByRole('menuitem', { name: 'Delete folder…' }).click()
    const confirm = page.getByRole('dialog', { name: 'Delete folder “Specs”?' })
    await expect(confirm.getByText('Its 1 document moves to Archive. Nothing is deleted.')).toBeVisible()
    await confirm.getByRole('button', { name: 'Delete folder' }).click()

    await expect(list.getByRole('button', { name: 'Specs', exact: true })).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'In Archive' }).getByRole('link', { name: 'Roadmap' })).toBeVisible()
    await expect.poll(serverFolderOf).toBe(await folderId('Archive'))
    await expect.poll(async () => (await folders()).map((folder) => folder.name)).toEqual(['Archive'])
})
