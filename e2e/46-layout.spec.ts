import { expect, newAccount, projectOf, signedInAs, test, type Account, type World } from './support/app'
import type { Page } from '@playwright/test'

// LAM-201: one page layout. The body is centred in the area beside the sidebar, the
// page's buttons are at the window's right edge, and the List | Board switch is in
// the same place on the list and on the board.

async function boardIdOf(account: Account, world: World) {
    const { data } = await account.api.POST('/api/v1/boards/list', { body: { project_id: world.projectId } })
    const id = data?.items?.[0]?.id
    if (!id) throw new Error('the project has no default board')
    return id
}

const box = async (page: Page, selector: string) => {
    const found = await page.locator(selector).first().boundingBox()
    if (!found) throw new Error(`${selector} is not on screen`)
    return found
}

/** The margin left and right of the page's body, inside <main>'s padding. */
async function margins(page: Page) {
    const main = await box(page, 'main')
    const body = await box(page, '.page__body')
    const padding = await page.locator('main').evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft))
    return {
        left: body.x - (main.x + padding),
        right: main.x + main.width - padding - (body.x + body.width),
        padding,
    }
}

const switchBox = async (page: Page) => {
    const found = await page.getByRole('navigation', { name: 'View' }).boundingBox()
    if (!found) throw new Error('the List | Board switch is not on screen')
    return found
}

const newTicketBox = async (page: Page) => {
    const found = await page.getByRole('button', { name: /^New ticket/ }).boundingBox()
    if (!found) throw new Error('New ticket is not on screen')
    return found
}

// LAM-214: New ticket is in the same place on the list and the board, at every width.
for (const [name, viewport] of [
    ['desktop', { width: 1280, height: 800 }],
    ['tablet', { width: 768, height: 1024 }],
    ['phone', { width: 375, height: 812 }],
] as const) {
    test(`the List | Board switch and New ticket have the same box on the list and on the board (${name})`, async ({ page, context, baseURL }) => {
        const account = await newAccount('layout-switch')
        const world = await projectOf(account)
        const boardId = await boardIdOf(account, world)
        await signedInAs(context, account, baseURL!)
        await page.setViewportSize(viewport)

        await page.goto(`/projects/${world.projectId}`)
        await expect(page.getByRole('heading', { level: 1, name: world.projectName })).toBeVisible()
        await expect(page.getByRole('button', { name: /^New ticket/ })).toBeEnabled()
        const onList = await switchBox(page)
        const newOnList = await newTicketBox(page)
        const listTitle = await page.getByRole('heading', { level: 1 }).boundingBox()

        await page.getByRole('navigation', { name: 'View' }).getByRole('link', { name: 'Board', exact: true }).click()
        await expect(page).toHaveURL(new RegExp(`/boards/${boardId}`))
        await expect(page.getByRole('heading', { level: 1, name: world.projectName })).toBeVisible()
        await expect(page.getByRole('navigation', { name: 'View' }).getByRole('link', { name: 'Board', exact: true })).toHaveAttribute(
            'aria-current',
            'page',
        )
        await expect(page.getByRole('button', { name: /^New ticket/ })).toBeEnabled()
        const onBoard = await switchBox(page)
        expect(await newTicketBox(page)).toEqual(newOnList)
        const boardTitle = await page.getByRole('heading', { level: 1 }).boundingBox()

        expect(onBoard).toEqual(onList)
        expect(boardTitle).toEqual(listTitle)
    })
}

test('at 1818px the body is centred and the page buttons are at the right edge, on the list, board, documents, epics and settings', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('layout-centre')
    const world = await projectOf(account)
    const boardId = await boardIdOf(account, world)
    const doc = await account.api.POST('/api/v1/documents', {
        params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: { title: 'Layout doc', type: 'normal', project_id: world.projectId, body: { content: 'Words.' } },
    })
    expect(doc.response.ok).toBe(true)
    await signedInAs(context, account, baseURL!)
    await page.setViewportSize({ width: 1818, height: 1000 })

    // [address, what proves it has loaded, the button that must reach the right edge (if any)]
    const pages: [string, () => Promise<void>, string | null][] = [
        [`/projects/${world.projectId}`, () => expect(page.getByRole('button', { name: /^New ticket/ })).toBeEnabled(), 'New ticket'],
        [`/boards/${boardId}`, () => expect(page.getByRole('button', { name: /^New ticket/ })).toBeEnabled(), 'New ticket'],
        [
            '/documents',
            async () => {
                await expect(page.getByRole('button', { name: 'New document' })).toBeEnabled()
                // The aspect types arrive after the page; the caret is part of the split button.
                await expect(page.getByRole('button', { name: 'New aspect: choose a type' })).toBeVisible()
            },
            'New document',
        ],
        ['/epics', () => expect(page.getByRole('heading', { level: 1, name: 'Epics' })).toBeVisible(), 'New epic'],
        ['/settings', () => expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible(), null],
    ]
    for (const [address, loaded, button] of pages) {
        await page.goto(address)
        await loaded()
        const { left, right, padding } = await margins(page)
        expect(Math.abs(left - right), `${address}: body margins ${left} / ${right}`).toBeLessThanOrEqual(2)
        if (button) {
            // New document is a split button (the button plus its aspect-type caret): the whole of it must reach the edge.
            const target =
                button === 'New document'
                    ? page.locator('main .doclist__split')
                    : page.locator('main').getByRole('button', { name: new RegExp(`^${button}`) }).first()
            const found = (await target.boundingBox())!
            const main = await box(page, 'main')
            expect(main.x + main.width - padding - (found.x + found.width), `${address}: ${button}`).toBeLessThanOrEqual(2)
        }
    }

    // The document: the body is centred and the Actions rail is at the right edge.
    await page.goto(`/documents/${doc.data!.id}`)
    await expect(page.getByLabel('Document title')).toHaveValue('Layout doc')
    const { left, right, padding } = await margins(page)
    expect(Math.abs(left - right)).toBeLessThanOrEqual(2)
    const rail = await box(page, '.page__rail aside')
    const main = await box(page, 'main')
    expect(main.x + main.width - padding - (rail.x + rail.width)).toBeLessThanOrEqual(2)
})

test('list items in a document: the bullet is beside its text, a task item has its checkbox beside it, a nested list indents', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('layout-bullets')
    const world = await projectOf(account)
    const doc = await account.api.POST('/api/v1/documents', {
        params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: {
            title: 'Bullets',
            type: 'normal',
            project_id: world.projectId,
            body: { content: ['- Walk', '- Slide', '  - Nested', '', '- [ ] Task', '- [x] Done task'].join('\n') },
        },
    })
    expect(doc.response.ok).toBe(true)
    await signedInAs(context, account, baseURL!)
    await page.goto(`/documents/${doc.data!.id}`)
    const editor = page.getByRole('textbox', { name: 'Document text' })
    await expect(editor.getByRole('listitem').first()).toBeVisible()

    // One line tall (22px), not two: nothing stands alone above its text.
    for (const li of await editor.locator('li').all()) {
        const own = await li.evaluate((el) => {
            const clone = el.cloneNode(true) as HTMLElement
            clone.querySelectorAll('ul').forEach((nested) => nested.remove())
            return clone.textContent!.trim()
        })
        const label = own.replace(/Task item checkbox for .*$/, '').trim() || own
        const first = await li.evaluate((el) => {
            const line = el.querySelector(':scope > p, :scope > div > p') as HTMLElement
            return line.getBoundingClientRect().height
        })
        expect(first, label).toBeLessThanOrEqual(30)
    }
    const slide = (await editor.getByRole('listitem').filter({ hasText: /^Slide/ }).first().locator('> p').boundingBox())!
    const nested = (await editor.getByRole('listitem').filter({ hasText: /^Nested$/ }).locator('> p').boundingBox())!
    expect(nested.x).toBeGreaterThan(slide.x + 12)
    // A task's box and its text share a line.
    const box = (await editor.getByRole('checkbox').first().boundingBox())!
    const text = (await editor.getByText('Task', { exact: true }).boundingBox())!
    expect(Math.abs(box.y + box.height / 2 - (text.y + text.height / 2))).toBeLessThan(12)
})
