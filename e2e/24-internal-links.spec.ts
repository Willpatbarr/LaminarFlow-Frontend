import { connectionIs, expect, fields, newAccount, projectOf, serverCreate, signedInAs, test } from './support/app'

// LAM-108: a link to another document is made from the editor with `[[`, shows
// the target's title as a chip, is stored as `lf://` Markdown, and the chip
// goes to the target. LAM-146: `[[` and `@` open a list at the caret, driven by
// real keystrokes; focus never leaves the editor.

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
    // The workspace is shared with other specs: titles carry a tag no other title has.
    const tag = crypto.randomUUID().slice(0, 8)
    const docB = `Doc B ${tag}`
    const a = await make('Doc A', '')
    const b = await make(docB, 'The target')
    const storedA = async () =>
        (await account.api.GET('/api/v1/documents/{id}', { params: { path: { id: a } } })).data?.body?.content

    await signedInAs(context, account, baseURL!)
    await page.goto(`/documents/${a}`)
    await expect(page.getByLabel('Title')).toHaveValue('Doc A')
    await connectionIs(page, 'Connected')

    const editor = page.getByRole('textbox', { name: 'Text' })
    await editor.click()
    await editor.pressSequentially(`See [[${docB}`)
    const list = page.getByRole('listbox', { name: 'Link to a ticket, document or project' })
    await expect(list.getByRole('option')).toHaveCount(1)
    await expect(list.getByRole('option', { name: docB })).toHaveAttribute('aria-selected', 'true')
    // The editor keeps focus while the list is open.
    await expect(editor).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(list).toBeHidden()

    const chip = editor.getByRole('link', { name: docB })
    await expect(chip).toBeVisible()
    await expect(chip).toHaveAttribute('href', `/documents/${b}`)
    // Stored as Markdown with the internal scheme.
    await expect.poll(storedA).toBe(`See [${docB}](lf://document/${b})`)

    await editor.getByRole('link').click()
    await expect(page).toHaveURL(new RegExp(`/documents/${b}$`))
    await expect(page.getByLabel('Title')).toHaveValue(docB)

    // After a reload the chip is still a chip.
    await page.goto(`/documents/${a}`)
    await expect(page.getByRole('textbox', { name: 'Text' }).getByRole('link', { name: docB })).toHaveAttribute(
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
    const shipped = `Ship the chips ${crypto.randomUUID().slice(0, 8)}`
    const ticket = await serverCreate(account, world.projectId, fields(shipped))

    await signedInAs(context, account, baseURL!)
    await page.goto(`/documents/${id}`)
    await expect(page.getByLabel('Title')).toHaveValue('Notes')
    await connectionIs(page, 'Connected')
    const editor = page.getByRole('textbox', { name: 'Text' })
    await editor.click()
    await editor.pressSequentially(`Blocked on @${shipped}`)
    const list = page.getByRole('listbox', { name: 'Link to a ticket, document or project' })
    await expect(list.getByRole('option')).toHaveCount(1)
    await expect(list.getByRole('option', { name: shipped })).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(editor.getByRole('link', { name: shipped })).toHaveAttribute('href', `/tickets/${ticket.id}`)
    await expect(list).toBeHidden()

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

test('the @ list moves with the arrows, cancels with Escape, shows an empty row, and a click picks', async ({ page, context, baseURL }) => {
    const account = await newAccount('chips3')
    const world = await projectOf(account)
    const made = await account.api.POST('/api/v1/documents', {
        params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: { title: 'Scratch', type: 'normal', project_id: world.projectId, body: { content: '' } },
    })
    const id = made.data!.id
    const tag = crypto.randomUUID().slice(0, 8)
    const alpha = `Alpha ${tag} task`
    const beta = `Beta ${tag} task`
    const first = await serverCreate(account, world.projectId, fields(alpha))
    await serverCreate(account, world.projectId, fields(beta))

    await signedInAs(context, account, baseURL!)
    await page.goto(`/documents/${id}`)
    await expect(page.getByLabel('Title')).toHaveValue('Scratch')
    await connectionIs(page, 'Connected')
    const editor = page.getByRole('textbox', { name: 'Text' })
    const list = page.getByRole('listbox', { name: 'Link to a ticket, document or project' })
    const stored = async () =>
        (await account.api.GET('/api/v1/documents/{id}', { params: { path: { id } } })).data?.body?.content

    // The top result is highlighted; the arrows move it; Enter picks it.
    await editor.click()
    await editor.pressSequentially(`@${tag} task`)
    await expect(list.getByRole('option')).toHaveCount(2)
    const options = list.getByRole('option')
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowDown')
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(editor).toHaveAttribute('aria-activedescendant', (await options.nth(1).getAttribute('id'))!)
    await page.keyboard.press('ArrowUp')
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(editor.getByRole('link')).toHaveCount(1)
    await expect(list).toBeHidden()
    await expect.poll(stored).toMatch(new RegExp(`^\\[(${alpha}|${beta})\\]\\(lf://ticket/[^)]+\\)$`))

    // Nothing matches: a row says so, and Escape closes the list and leaves the text.
    await editor.pressSequentially('@zzzz')
    await expect(list.getByRole('option')).toHaveText(/No tickets, documents or projects match/)
    await page.keyboard.press('Escape')
    await expect(list).toBeHidden()
    await expect(editor).toContainText('@zzzz')
    await expect(editor).toBeFocused()

    // A click picks that option.
    await editor.press('ControlOrMeta+a')
    await page.keyboard.press('Backspace')
    await editor.pressSequentially(`@${alpha}`)
    await list.getByRole('option', { name: new RegExp(alpha) }).click()
    await expect(editor.getByRole('link', { name: alpha })).toHaveAttribute('href', `/tickets/${first.id}`)
    await expect(editor).toBeFocused()
    await expect.poll(stored).toBe(`[${alpha}](lf://ticket/${first.id})`)
})
