import { connectionIs, expect, newAccount, projectOf, signedInAs, test, unique } from './support/app'

// LAM-98: make an aspect type, give it three fields, reorder them and remove one.
// Every assertion about "saved" reads the server, not the screen.
test('create a type with three fields, reorder them, and remove one after the count is shown', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('aspects')
    const world = await projectOf(account)
    await signedInAs(context, account, baseURL!)
    const name = unique('Spec')

    const serverType = async () => {
        const list = await account.api.GET('/api/v1/aspect-types', { params: { query: { team_id: world.teamId } } })
        const found = list.data?.items?.find((item) => item.name === name)
        if (!found) return undefined
        const one = await account.api.GET('/api/v1/aspect-types/{id}', { params: { path: { id: found.id } } })
        return one.data
    }
    const serverLabels = async () => ((await serverType())?.fields ?? []).map((f) => f.label)
    const shown = () =>
        page
            .getByRole('list', { name: 'Fields' })
            .getByRole('textbox')
            .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))

    // Reachable from team settings; the starters are listed.
    await page.goto(`/teams/${world.teamId}/settings`)
    await page.getByRole('link', { name: 'Edit aspect types' }).click()
    await expect(page.getByRole('heading', { name: 'Aspect types' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Aspect types' }).getByRole('link').first()).toBeVisible()
    await connectionIs(page, 'Live')

    // Create: lands in the editor.
    await page.getByLabel('New aspect type name').fill(name)
    await page.getByRole('button', { name: 'Add aspect type' }).click()
    await expect(page.getByLabel('Aspect type name')).toHaveValue(name)

    for (const label of ['Goal', 'Risks', 'Owner']) {
        await page.getByLabel('New field label').fill(label)
        await page.getByRole('button', { name: 'Add field' }).click()
        await expect(page.getByLabel(`Label of ${label}`)).toBeVisible()
    }
    await expect.poll(shown).toEqual(['Goal', 'Risks', 'Owner'])
    await expect.poll(serverLabels).toEqual(['Goal', 'Risks', 'Owner'])

    // Reorder: the last one to the top.
    await page.getByRole('button', { name: 'Move Owner up' }).click()
    await page.getByRole('button', { name: 'Move Owner up' }).click()
    await expect.poll(shown).toEqual(['Owner', 'Goal', 'Risks'])
    await expect.poll(serverLabels).toEqual(['Owner', 'Goal', 'Risks'])

    // A document holds a value in Goal, so removing Goal says how many.
    const type = (await serverType())!
    const goal = type.fields!.find((f) => f.label === 'Goal')!
    const made = await account.api.POST('/api/v1/documents', {
        params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: { title: 'Uses Goal', type: 'aspect', aspect_type_id: type.id, body: { [goal.id]: 'ship it' } },
    })
    expect(made.response.ok).toBe(true)

    await page.getByRole('button', { name: 'Remove Goal' }).click()
    const dialog = page.getByRole('dialog', { name: /Remove .Goal./ })
    await expect(dialog).toContainText('1 document has a value in this field')
    await dialog.getByRole('button', { name: 'Remove field' }).click()

    await expect.poll(shown).toEqual(['Owner', 'Risks'])
    await expect.poll(serverLabels).toEqual(['Owner', 'Risks'])

    // And it survives a reload.
    await page.reload()
    await expect.poll(shown).toEqual(['Owner', 'Risks'])
})
