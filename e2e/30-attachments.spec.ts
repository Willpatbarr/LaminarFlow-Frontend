import { readFile } from 'node:fs/promises'

import { connectionIs, expect, fields, newAccount, openTicket, projectOf, serverCreate, signedInAs, test } from './support/app'

// LAM-116: an image pasted into a document is uploaded and embedded and is still
// there after a reload; files attach to a ticket, download and delete; a file
// over the server's limit says what the limit is.

const UUID = /\/documents\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// A real 1x1 PNG: the server decides the type from the bytes.
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
)

test('an image pasted into a document uploads, embeds, and is still there after a reload', async ({ page, context, baseURL }) => {
    const account = await newAccount('images')
    await signedInAs(context, account, baseURL!)

    await page.goto('/documents')
    await page.getByRole('button', { name: 'New document' }).click()
    await expect(page).toHaveURL(UUID)
    const id = page.url().split('/').pop()!

    const editor = page.getByRole('textbox', { name: 'Document text' })
    await editor.click()
    await editor.evaluate((el, base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        const data = new DataTransfer()
        data.items.add(new File([bytes], 'screen shot.png', { type: 'image/png' }))
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, PNG.toString('base64'))

    const image = editor.locator('img')
    await expect(image).toHaveCount(1)
    await expect(image).toHaveAttribute('src', /^\/api\/v1\/attachments\/[0-9a-f-]{36}$/)
    await expect(image).toHaveAttribute('alt', 'screen shot')
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1)
    await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()

    // Stored as a Markdown image, and the image is an attachment of the document.
    await expect
        .poll(async () => (await account.api.GET('/api/v1/documents/{id}', { params: { path: { id } } })).data?.body.content)
        .toMatch(/^!\[screen shot\]\(\/api\/v1\/attachments\/[0-9a-f-]{36}\)$/)
    await expect(page.getByRole('region', { name: 'Attachments' }).getByRole('link', { name: 'screen shot.png' })).toBeVisible()

    await page.reload()
    const again = page.getByRole('textbox', { name: 'Document text' }).locator('img')
    await expect(again).toHaveCount(1)
    await expect.poll(() => again.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1)
})

test('a ticket takes an attachment, downloads it and deletes it', async ({ page, context, baseURL }) => {
    const account = await newAccount('files')
    const world = await projectOf(account)
    const ticket = await serverCreate(account, world.projectId, fields('Has files'))
    await signedInAs(context, account, baseURL!)
    await openTicket(page, ticket.id, 'Has files')
    await connectionIs(page, 'Connected')

    const section = page.getByRole('region', { name: 'Attachments' })
    await expect(section.getByText('No attachments.')).toBeVisible()

    await section.getByLabel('Attach files').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello attachments') })
    const row = section.getByRole('listitem').filter({ hasText: 'notes.txt' })
    await expect(row).toBeVisible()
    await expect(row).toContainText('17 B')
    const listed = await account.api.POST('/api/v1/attachments/list', {
        body: { filter: { op: 'and', conditions: [{ field: 'ticket_id', op: 'eq', value: ticket.id }] } },
    })
    expect(listed.data?.items?.map((a) => a.filename)).toEqual(['notes.txt'])

    const download = page.waitForEvent('download')
    await row.getByRole('link', { name: 'notes.txt' }).click()
    const saved = await download
    expect(saved.suggestedFilename()).toBe('notes.txt')
    expect(await readFile((await saved.path())!, 'utf8')).toBe('hello attachments')

    // It is still there after a reload (it is the server's, not a local copy).
    await page.reload()
    await expect(section.getByRole('listitem').filter({ hasText: 'notes.txt' })).toBeVisible()

    await section.getByRole('button', { name: 'Delete notes.txt' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(section.getByText('No attachments.')).toBeVisible()
    const after = await account.api.POST('/api/v1/attachments/list', {
        body: { filter: { op: 'and', conditions: [{ field: 'ticket_id', op: 'eq', value: ticket.id }] } },
    })
    expect(after.data?.items ?? []).toHaveLength(0)
})

test('a file over the limit is refused and the field says what the limit is; a refused type says so too', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('toobig')
    const world = await projectOf(account)
    const ticket = await serverCreate(account, world.projectId, fields('Too big'))
    await signedInAs(context, account, baseURL!)
    await openTicket(page, ticket.id, 'Too big')

    const section = page.getByRole('region', { name: 'Attachments' })
    await section.getByLabel('Attach files').setInputFiles({
        name: 'huge.bin',
        mimeType: 'application/octet-stream',
        buffer: Buffer.alloc(26 * 1024 * 1024),
    })
    await expect(section.getByRole('alert')).toContainText('huge.bin is too large. Files can be at most 25 MB.')
    await expect(section.getByText('No attachments.')).toBeVisible()

    await section.getByRole('button', { name: 'Dismiss' }).click()
    await section.getByLabel('Attach files').setInputFiles({
        name: 'page.html',
        mimeType: 'text/html',
        buffer: Buffer.from('<html><script>alert(1)</script></html>'),
    })
    await expect(section.getByRole('alert')).toContainText('page.html')
    await expect(section.getByRole('alert')).toContainText('cannot be attached')
})
