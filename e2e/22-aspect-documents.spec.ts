import { expect, newAccount, projectOf, signedInAs, test, unique } from './support/app'

// LAM-109: a document becomes an Aspect of a type, its fields are labeled
// editors, and everything typed is still there after a reload. Every claim about
// "saved" reads the server.

const UUID = /\/documents\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

test('convert a document to a Class aspect, fill two fields, and reload', async ({ page, context, baseURL }) => {
    const account = await newAccount('aspect-docs')
    const world = await projectOf(account)

    // The starter Class type: give it two fields.
    const types = await account.api.GET('/api/v1/aspect-types', { params: { query: { team_id: world.teamId } } })
    const klass = types.data!.items!.find((item) => item.name === 'Class')!
    expect(klass).toBeTruthy()
    for (const label of ['Purpose', 'Invariants']) {
        const added = await account.api.POST('/api/v1/aspect-types/{id}/fields', {
            params: { path: { id: klass.id } },
            body: { label },
        })
        expect(added.response.ok).toBe(true)
    }
    const type = (await account.api.GET('/api/v1/aspect-types/{id}', { params: { path: { id: klass.id } } })).data!
    const purpose = type.fields!.find((x) => x.label === 'Purpose')!
    const invariants = type.fields!.find((x) => x.label === 'Invariants')!

    await signedInAs(context, account, baseURL!)
    // Filed under the spec's project, so only its team's types are offered.
    const made = await account.api.POST('/api/v1/documents', {
        params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: { title: '', type: 'normal', project_id: world.projectId, body: { content: '' } },
    })
    const id = made.data!.id
    await page.goto(`/documents/${id}`)
    await page.getByLabel('Document title').fill('Order')
    await page.getByRole('textbox', { name: 'Document text' }).click()
    await page.keyboard.type('Existing words')
    await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()

    // Make it an Aspect: the text moves into the first field.
    await page.getByLabel('Aspect type').selectOption({ label: 'Class' })
    await page.getByRole('button', { name: 'Make this an Aspect' }).click()
    await expect(page.getByRole('textbox', { name: 'Document text' })).toHaveCount(0)
    const first = page.getByRole('textbox', { name: 'Purpose' })
    await expect(first).toContainText('Existing words')
    await expect(page.getByRole('textbox', { name: 'Invariants' })).toBeVisible()

    await first.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type(' and more')
    const second = page.getByRole('textbox', { name: 'Invariants' })
    await second.click()
    await page.keyboard.type('Total is never negative')

    await expect
        .poll(async () => {
            const got = await account.api.GET('/api/v1/documents/{id}', { params: { path: { id } } })
            return got.data
        })
        .toMatchObject({
            type: 'aspect',
            aspect_type_id: klass.id,
            body: { [purpose.id]: 'Existing words and more', [invariants.id]: 'Total is never negative' },
        })

    await page.reload()
    await expect(page.getByLabel('Document title')).toHaveValue('Order')
    await expect(page.getByRole('textbox', { name: 'Purpose' })).toContainText('Existing words and more')
    await expect(page.getByRole('textbox', { name: 'Invariants' })).toContainText('Total is never negative')
})

test('a type with no fields is refused with its reason, and a new field appears in an open document', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('aspect-docs-2')
    const world = await projectOf(account)
    const name = unique('Empty')
    const made = await account.api.POST('/api/v1/aspect-types', { body: { team_id: world.teamId, name } })
    const typeId = made.data!.id
    const doc = await account.api.POST('/api/v1/documents', {
        params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: { title: 'Plain', type: 'normal', project_id: world.projectId, body: { content: 'text' } },
    })
    await signedInAs(context, account, baseURL!)
    await page.goto(`/documents/${doc.data!.id}`)

    await page.getByLabel('Aspect type').selectOption({ label: name })
    await page.getByRole('button', { name: 'Make this an Aspect' }).click()
    await expect(page.getByText('has no fields yet')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Document text' })).toBeVisible()

    // Once the type has a field the same action works, and a field added later
    // shows up in the open document, empty.
    await account.api.POST('/api/v1/aspect-types/{id}/fields', { params: { path: { id: typeId } }, body: { label: 'Summary' } })
    await page.getByRole('button', { name: 'Make this an Aspect' }).click()
    await expect(page.getByRole('textbox', { name: 'Summary' })).toContainText('text')

    await account.api.POST('/api/v1/aspect-types/{id}/fields', { params: { path: { id: typeId } }, body: { label: 'Later' } })
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect(page.getByRole('textbox', { name: 'Later' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Later' })).not.toContainText(/\S/)
})

test('create a document directly as an aspect', async ({ page, context, baseURL }) => {
    const account = await newAccount('aspect-docs-3')
    const world = await projectOf(account)
    const name = unique('Direct')
    const made = await account.api.POST('/api/v1/aspect-types', { body: { team_id: world.teamId, name } })
    const added = await account.api.POST('/api/v1/aspect-types/{id}/fields', {
        params: { path: { id: made.data!.id } },
        body: { label: 'Notes' },
    })
    const field = added.data!
    await signedInAs(context, account, baseURL!)

    await page.goto('/documents')
    await page.getByLabel('New aspect').selectOption({ label: name })
    await expect(page).toHaveURL(UUID)
    const id = page.url().split('/').pop()!
    const notes = page.getByRole('textbox', { name: 'Notes' })
    await notes.click()
    await page.keyboard.type('Typed straight in')
    await expect
        .poll(async () => (await account.api.GET('/api/v1/documents/{id}', { params: { path: { id } } })).data)
        .toMatchObject({ type: 'aspect', aspect_type_id: made.data!.id, body: { [field.id]: 'Typed straight in' } })
    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Notes' })).toContainText('Typed straight in')
})
