import { readFile, writeFile } from 'node:fs/promises'

import { expect, newAccount, projectOf, signedInAs, test, unique } from './support/app'

// LAM-119: export a type to a file and import that file back. Into the same team the
// name is taken, so the copy is "<name> (2)" with the same fields, and the screen says so.
// What was saved is read from the server, not the screen.
test('export a type, import the file, and get a copy named with (2) and the same fields', async ({
    page,
    context,
    baseURL,
}, testInfo) => {
    const account = await newAccount('aspect-portable')
    const world = await projectOf(account)
    await signedInAs(context, account, baseURL!)
    const name = unique('Portable')

    const made = await account.api.POST('/api/v1/aspect-types', { body: { team_id: world.teamId, name } })
    expect(made.response.ok).toBe(true)
    for (const label of ['Goal', 'Risks', 'Owner']) {
        const added = await account.api.POST('/api/v1/aspect-types/{id}/fields', {
            params: { path: { id: made.data!.id } },
            body: { label },
        })
        expect(added.response.ok).toBe(true)
    }

    // Export: a .json file named after the type, with no ids in it.
    await page.goto(`/teams/${world.teamId}/aspect-types/${made.data!.id}`)
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export JSON' }).click()
    const saved = await download
    expect(saved.suggestedFilename()).toMatch(/^portable-.*\.aspect-type\.json$/)
    const path = testInfo.outputPath('exported.aspect-type.json')
    await saved.saveAs(path)
    const file = JSON.parse(await readFile(path, 'utf8'))
    expect(Object.keys(file).sort()).toEqual(['fields', 'format_version', 'name'])
    expect(file.format_version).toBe(1)
    expect(file.name).toBe(name)
    expect(file.fields.map((f: { label: string }) => f.label)).toEqual(['Goal', 'Risks', 'Owner'])
    expect(Object.keys(file.fields[0]).sort()).toEqual(['label', 'position'])

    // Import it on the list: a preview first, nothing created until confirmed.
    await page.goto(`/teams/${world.teamId}/aspect-types`)
    await page.getByLabel('Aspect type file').setInputFiles(path)
    const dialog = page.getByRole('dialog', { name: new RegExp(`Import .${name}.`) })
    await expect(dialog.getByRole('listitem')).toHaveText(['Goal', 'Risks', 'Owner'])
    await dialog.getByRole('button', { name: 'Import' }).click()

    // Lands in the editor of the copy, and says it was renamed.
    await expect(page.getByLabel('Aspect type name')).toHaveValue(`${name} (2)`)
    await expect(page.getByText(`Imported as “${name} (2)”`)).toBeVisible()

    const list = await account.api.GET('/api/v1/aspect-types', { params: { query: { team_id: world.teamId } } })
    const copy = list.data!.items!.find((item) => item.name === `${name} (2)`)!
    expect(copy.id).not.toBe(made.data!.id)
    const one = await account.api.GET('/api/v1/aspect-types/{id}', { params: { path: { id: copy.id } } })
    expect(one.data!.fields!.map((f) => f.label)).toEqual(['Goal', 'Risks', 'Owner'])

    // A file that is wrong is named, and nothing is created.
    const bad = testInfo.outputPath('bad.json')
    await writeFile(bad, JSON.stringify({ ...file, fields: [{ label: '', position: 1 }] }))
    await page.goto(`/teams/${world.teamId}/aspect-types`)
    await page.getByLabel('Aspect type file').setInputFiles(bad)
    await expect(page.getByRole('alert')).toContainText('fields[0].label')
    await expect(page.getByRole('dialog')).toHaveCount(0)
})
