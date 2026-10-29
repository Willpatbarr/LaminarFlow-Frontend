import { connectionIs, expect, fields, newAccount, projectOf, serverCreate, signedInAs, test } from './support/app'

// LAM-108: a link to another document is made from the editor with `[[`, shows
// the target's title as a chip, is stored as `lf://` Markdown, and the chip
// goes to the target.

test('link document A to document B with [[, click the chip, and land on B', async ({ page, context, baseURL }) => {
    const account = await newAccount('chips')
    const world = await projectOf(account)
    const make = async (title: string, content: string) => {
        const made = await account.api.POST('/api/v1/documents', {
            params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
            body: { title, type: 'normal', project_id: world.projectId, body: { content } },
        })
        expect(made.response.ok).toBe(true)
        return made.data!.id
    }
    const a = await make('Doc A', '')
    const b = await make('Doc B', 'The target')
    const storedA = async () =>
        (await account.api.GET('/api/v1/documents/{id}', { params: { path: { id: a } } })).data?.body?.content

    await signedInAs(context, account, baseURL!)
    await page.goto(`/documents/${a}`)
    await expect(page.getByLabel('Title')).toHaveValue('Doc A')
    await connectionIs(page, 'Live')

    const editor = page.getByRole('textbox', { name: 'Text' })
    await editor.click()
    await page.keyboard.type('See [[')
    const picker = page.getByRole('dialog', { name: 'Link to a ticket, document or project' })
    await picker.getByLabel('Search tickets, documents and projects').fill('Doc B')
    await picker.getByRole('radio', { name: /Doc B/ }).check()
    await picker.getByRole('button', { name: 'Link' }).click()

    const chip = editor.getByRole('link', { name: 'Doc B' })
    await expect(chip).toBeVisible()
    await expect(chip).toHaveAttribute('href', `/documents/${b}`)
    // Stored as Markdown with the internal scheme.
    await expect.poll(storedA).toBe(`See [Doc B](lf://document/${b})`)

    await editor.getByRole('link').click()
    await expect(page).toHaveURL(new RegExp(`/documents/${b}$`))
    await expect(page.getByLabel('Title')).toHaveValue('Doc B')

    // After a reload the chip is still a chip.
    await page.goto(`/documents/${a}`)
    await expect(page.getByRole('textbox', { name: 'Text' }).getByRole('link', { name: 'Doc B' })).toHaveAttribute(
        'href',
        `/documents/${b}`,
    )
})

test('@ links a ticket and a pasted internal URL becomes a chip', async ({ page, context, baseURL }) => {
    const account = await newAccount('chips2')
    const world = await projectOf(account)
    const made = await account.api.POST('/api/v1/documents', {
        params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: { title: 'Notes', type: 'normal', project_id: world.projectId, body: { content: '' } },
    })
    const id = made.data!.id
    const ticket = await serverCreate(account, world.projectId, fields('Ship the chips'))

    await signedInAs(context, account, baseURL!)
    await page.goto(`/documents/${id}`)
    await expect(page.getByLabel('Title')).toHaveValue('Notes')
    await connectionIs(page, 'Live')
    const editor = page.getByRole('textbox', { name: 'Text' })
    await editor.click()
    await page.keyboard.type('Blocked on @')
    const picker = page.getByRole('dialog', { name: 'Link to a ticket, document or project' })
    await picker.getByLabel('Search tickets, documents and projects').fill('Ship the')
    await picker.getByRole('radio', { name: /Ship the chips/ }).check()
    await picker.getByRole('button', { name: 'Link' }).click()
    await expect(editor.getByRole('link', { name: 'Ship the chips' })).toHaveAttribute('href', `/tickets/${ticket.id}`)

    // A pasted address of this app, and one of another site.
    await editor.evaluate((el, url) => {
        const event = new Event('paste', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'clipboardData', { value: { getData: (t: string) => (t === 'text/plain' ? url : ''), types: ['text/plain'] } })
        el.dispatchEvent(event)
    }, `${new URL(page.url()).origin}/documents/${id}`)
    await expect(editor.getByRole('link', { name: 'Notes' })).toHaveAttribute('href', `/documents/${id}`)
    await expect
        .poll(async () => (await account.api.GET('/api/v1/documents/{id}', { params: { path: { id } } })).data?.body?.content)
        .toContain(`(lf://document/${id})`)
})
