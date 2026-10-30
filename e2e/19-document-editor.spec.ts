import { expect, newAccount, signedInAs, test } from './support/app'

// LAM-96: a document is created, Markdown typed and pasted renders, it is saved
// through the outbox, and a reload shows it still there.

const UUID = /\/documents\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

test('Markdown typed and pasted renders, is stored as Markdown, and survives a reload', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('docs')
    await signedInAs(context, account, baseURL!)

    await page.goto('/documents')
    await page.getByRole('button', { name: 'New document' }).click()
    await expect(page).toHaveURL(UUID)
    const id = page.url().split('/').pop()!

    await page.getByLabel('Document title').fill('Meeting notes')
    const editor = page.getByRole('textbox', { name: 'Document text' })
    await editor.click()
    // Shortcuts as you type: "# " makes a heading, "- " a list, ** ** bold.
    await page.keyboard.type('# Agenda')
    await page.keyboard.press('Enter')
    await page.keyboard.type('- first item')
    await page.keyboard.press('Enter')
    await page.keyboard.type('second item')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Some **bold** words')

    await expect(editor.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
    await expect(editor.getByRole('listitem')).toHaveCount(2)
    await expect(editor.locator('strong')).toHaveText('bold')

    // Pasted Markdown renders.
    await page.keyboard.press('Enter')
    await editor.evaluate((el) => {
        const data = new DataTransfer()
        data.setData('text/plain', '## Pasted\n\n1. one\n2. two\n\nSee [a ticket](lf://ticket/abc-123).')
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    })
    await expect(editor.getByRole('heading', { level: 2, name: 'Pasted' })).toBeVisible()
    await expect(editor.locator('ol > li')).toHaveCount(2)
    await expect(editor.getByRole('link', { name: 'a ticket' })).toHaveAttribute('href', '/tickets/abc-123')

    // Saved through the outbox, and said so.
    await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()

    // On the server it is plain Markdown under `content`.
    await expect
        .poll(async () => {
            const got = await account.api.GET('/api/v1/documents/{id}', { params: { path: { id } } })
            return got.data
        })
        .toMatchObject({
            title: 'Meeting notes',
            body: { content: expect.stringContaining('# Agenda') },
        })
    const stored = (await account.api.GET('/api/v1/documents/{id}', { params: { path: { id } } })).data!
    const content = stored.body.content as string
    expect(content).toContain('- first item\n- second item')
    expect(content).toContain('Some **bold** words')
    expect(content).toContain('## Pasted')
    expect(content).toContain('[a ticket](lf://ticket/abc-123)')

    await page.reload()
    await expect(page.getByLabel('Document title')).toHaveValue('Meeting notes')
    const again = page.getByRole('textbox', { name: 'Document text' })
    await expect(again.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
    await expect(again.locator('strong')).toHaveText('bold')
    await expect(again.getByRole('link', { name: 'a ticket' })).toHaveAttribute('href', '/tickets/abc-123')
})

test('a document written by an API client opens rendered, and its internal links are kept on save', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('docs-api')
    const made = await account.api.POST('/api/v1/documents', {
        params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: {
            title: 'From a script',
            type: 'normal',
            body: { content: 'Read [the doc](lf://document/d-1) and [the project](lf://project/p-1).' },
        },
    })
    expect(made.response.ok).toBe(true)
    const id = made.data!.id
    await signedInAs(context, account, baseURL!)

    await page.goto(`/documents/${id}`)
    const editor = page.getByRole('textbox', { name: 'Document text' })
    await expect(editor.getByRole('link', { name: 'the doc' })).toHaveAttribute('href', '/documents/d-1')

    await editor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type(' Edited.')

    await expect
        .poll(async () => {
            const got = await account.api.GET('/api/v1/documents/{id}', { params: { path: { id } } })
            return got.data?.body.content
        })
        .toBe('Read [the doc](lf://document/d-1) and [the project](lf://project/p-1). Edited.')
})
