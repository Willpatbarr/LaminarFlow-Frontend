import { connectionIs, expect, fields, listLoaded, newAccount, projectOf, serverCreate, signedInAs, test, unique } from './support/app'

// LAM-115: Cmd/Ctrl+K opens a search palette from anywhere; a ticket is found
// by its title and a document by the text in its body, and both are opened
// with the keyboard alone.

test('find a ticket by title and open it without the mouse', async ({ page, context, baseURL }) => {
    const account = await newAccount('palette')
    const world = await projectOf(account)
    const title = unique('Reindex the heron')
    const ticket = await serverCreate(account, world.projectId, fields(title))

    await signedInAs(context, account, baseURL!)
    await page.goto('/')
    await listLoaded(page)
    await connectionIs(page, 'Live')

    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: 'Search' })
    await expect(palette).toBeVisible()
    await expect(palette.getByRole('combobox')).toBeFocused()

    // `c` is the new-ticket shortcut on the list; in the palette it is a letter.
    await page.keyboard.type(title)
    await expect(page.getByRole('dialog', { name: 'New ticket' })).toHaveCount(0)
    const option = palette.getByRole('option', { name: new RegExp(title) })
    await expect(option).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(new RegExp(`/tickets/${ticket.id}$`))
    await expect(page.getByLabel('Title')).toHaveValue(title)
    await expect(palette).toHaveCount(0)
})

test('find a document by text in its body, from inside the editor', async ({ page, context, baseURL }) => {
    const account = await newAccount('palette2')
    const world = await projectOf(account)
    const word = unique('kestrel')
    const make = async (docTitle: string, content: string) => {
        const made = await account.api.POST('/api/v1/documents', {
            params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
            body: { title: docTitle, type: 'normal', project_id: world.projectId, body: { content } },
        })
        expect(made.response.ok).toBe(true)
        return made.data!.id
    }
    const target = await make(unique('Field notes'), `Spotted a ${word} on the roof.`)
    const start = await make(unique('Start here'), '')

    await signedInAs(context, account, baseURL!)
    await page.goto(`/documents/${start}`)
    await expect(page.getByLabel('Title')).toHaveValue(/Start here/)
    await connectionIs(page, 'Live')

    // The chord works with the cursor in the editor, and typing there is untouched.
    const editor = page.getByRole('textbox', { name: 'Text' })
    await editor.click()
    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: 'Search' })
    await expect(palette).toBeVisible()
    await page.keyboard.type(word)

    const option = palette.getByRole('option', { name: /Field notes/ })
    await expect(option).toBeVisible()
    await expect(option.locator('mark').first()).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(new RegExp(`/documents/${target}$`))
    await expect(page.getByLabel('Title')).toHaveValue(/Field notes/)
})

test('Escape closes it and the New ticket command opens the dialog', async ({ page, context, baseURL }) => {
    const account = await newAccount('palette3')
    await projectOf(account)
    await signedInAs(context, account, baseURL!)
    await page.goto('/')
    await listLoaded(page)
    await connectionIs(page, 'Live')

    await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Search' })).toHaveCount(0)

    await page.keyboard.press('Control+k')
    await page.keyboard.type('new tick')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'New ticket' })).toBeVisible()
})

test('the New document command makes a document and opens it', async ({ page, context, baseURL }) => {
    const account = await newAccount('palette4')
    await projectOf(account)
    await signedInAs(context, account, baseURL!)
    await page.goto('/')
    await listLoaded(page)

    await page.keyboard.press('Control+k')
    await page.keyboard.type('new doc')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/documents\/[^/]+$/)
    await expect(page.getByRole('textbox', { name: 'Text' })).toBeVisible()
})
