import {
    connectionIs,
    expect,
    fields,
    newAccount,
    projectOf,
    serverCreate,
    serverTicket,
    signedInAs,
    test,
    type Account,
    type World,
} from './support/app'

// LAM-107: the Kanban board. Every assertion about "saved" reads the server.

async function boardOf(account: Account, world: World) {
    const { data } = await account.api.POST('/api/v1/boards/list', { body: { project_id: world.projectId } })
    const board = data?.items?.[0]
    if (!board) throw new Error('the project has no default board')
    return board
}

const column = (page: import('@playwright/test').Page, name: string) => page.getByRole('region', { name, exact: true })
const cardsIn = (page: import('@playwright/test').Page, name: string) =>
    column(page, name).getByRole('listitem').getByRole('link').allTextContents()

test('a dragged card changes status and keeps its place; the move survives a reload and shows live in a second browser', async ({
    page,
    context,
    browser,
    baseURL,
}) => {
    const alice = await newAccount('alice')
    const bob = await newAccount('bob')
    const world = await projectOf(alice)
    const [todo, doing] = world.statusIds
    const [todoName, doingName] = world.statusNames
    const one = await serverCreate(alice, world.projectId, fields('Card one', { status_id: todo }))
    const two = await serverCreate(alice, world.projectId, fields('Card two', { status_id: todo }))
    const three = await serverCreate(alice, world.projectId, fields('Card three', { status_id: doing }))
    const board = await boardOf(alice, world)

    await signedInAs(context, alice, baseURL!)
    const bobContext = await browser.newContext()
    await signedInAs(bobContext, bob, baseURL!)
    const bobPage = await bobContext.newPage()

    // Reachable from the project's ticket list.
    await page.goto(`/projects/${world.projectId}`)
    await page.getByRole('link', { name: 'Board', exact: true }).click()
    await expect(page.getByRole('heading', { name: board.name })).toBeVisible()
    await expect.poll(() => cardsIn(page, todoName)).toEqual(['Card one', 'Card two'])
    await expect.poll(() => cardsIn(page, doingName)).toEqual(['Card three'])

    await bobPage.goto(`/boards/${board.id}`)
    await expect.poll(() => cardsIn(bobPage, todoName)).toEqual(['Card one', 'Card two'])
    await connectionIs(page, 'Live')
    await connectionIs(bobPage, 'Live')

    // Drag "Card one" onto the lower half of "Card three": after it, in the other column.
    const target = column(page, doingName).getByRole('listitem', { name: 'Card three' })
    const box = (await target.boundingBox())!
    await page.getByRole('listitem', { name: 'Card one' }).dragTo(target, { targetPosition: { x: box.width / 2, y: box.height - 2 } })

    // At once on this screen, then on the server (status and place), then live elsewhere.
    await expect.poll(() => cardsIn(page, doingName)).toEqual(['Card three', 'Card one'])
    await expect.poll(async () => (await serverTicket(alice, one.id))?.status_id).toBe(doing)
    const [first, last] = [(await serverTicket(alice, three.id))!, (await serverTicket(alice, one.id))!]
    expect(last.position).toBeGreaterThan(first.position)
    await expect.poll(() => cardsIn(bobPage, doingName)).toEqual(['Card three', 'Card one'])
    await expect.poll(() => cardsIn(bobPage, todoName)).toEqual(['Card two'])

    // The move held.
    await page.reload()
    await expect.poll(() => cardsIn(page, doingName)).toEqual(['Card three', 'Card one'])
    await expect.poll(() => cardsIn(page, todoName)).toEqual(['Card two'])
    expect((await serverTicket(alice, two.id))?.status_id).toBe(todo)
})

test('a card moves with the keyboard, within and between columns', async ({ page, context, baseURL }) => {
    const alice = await newAccount('keys')
    const world = await projectOf(alice)
    const [todo, doing] = world.statusIds
    const [todoName, doingName] = world.statusNames
    const a = await serverCreate(alice, world.projectId, fields('Alpha', { status_id: todo }))
    await serverCreate(alice, world.projectId, fields('Beta', { status_id: todo }))
    const board = await boardOf(alice, world)

    await signedInAs(context, alice, baseURL!)
    await page.goto(`/boards/${board.id}`)
    await expect.poll(() => cardsIn(page, todoName)).toEqual(['Alpha', 'Beta'])

    // Down within the column: Alpha goes below Beta.
    await page.getByRole('listitem', { name: 'Alpha' }).focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Space')
    await expect.poll(() => cardsIn(page, todoName)).toEqual(['Beta', 'Alpha'])

    // Right into the next column.
    await page.getByRole('listitem', { name: 'Alpha' }).focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Space')
    await expect.poll(() => cardsIn(page, doingName)).toEqual(['Alpha'])
    await expect.poll(async () => (await serverTicket(alice, a.id))?.status_id).toBe(doing)
    // Focus followed the card.
    await expect(page.getByRole('listitem', { name: 'Alpha' })).toBeFocused()
})

test('the column menu renames, hides and shows a column, and the board survives a reload', async ({ page, context, baseURL }) => {
    const alice = await newAccount('menu')
    const world = await projectOf(alice)
    const [todoName, doingName, doneName] = world.statusNames
    const board = await boardOf(alice, world)

    await signedInAs(context, alice, baseURL!)
    await page.goto(`/boards/${board.id}`)
    await expect(column(page, todoName)).toBeVisible()
    await connectionIs(page, 'Live')

    const serverColumns = async () => {
        const { data } = await alice.api.GET('/api/v1/boards/{id}', { params: { path: { id: board.id } } })
        return [...(data?.columns ?? [])].sort((x, y) => x.position - y.position)
    }

    // Rename.
    await page.getByLabel(`Column options for ${todoName}`).click()
    const name = page.getByLabel(`Name of column ${todoName}`)
    await name.fill('Backlog')
    await name.press('Enter')
    await expect(column(page, 'Backlog')).toBeVisible()
    await expect.poll(async () => (await serverColumns()).map((c) => c.name)).toEqual(['Backlog', doingName, doneName])

    // Reorder: the first column one place to the right.
    await page.getByRole('button', { name: 'Move Backlog right' }).click()
    await expect.poll(async () => (await serverColumns()).map((c) => c.name)).toEqual([doingName, 'Backlog', doneName])

    // Hide, then show.
    await page.getByLabel(`Column options for ${doneName}`).click()
    await page.getByRole('button', { name: `Hide column ${doneName}` }).click()
    await expect(column(page, doneName)).toHaveCount(0)
    await expect.poll(async () => (await serverColumns()).find((c) => c.name === doneName)?.is_visible).toBe(false)

    await page.reload()
    await expect(column(page, 'Backlog')).toBeVisible()
    await expect(column(page, doneName)).toHaveCount(0)
    await page.getByRole('button', { name: `Show column ${doneName}` }).click()
    await expect(column(page, doneName)).toBeVisible()
    await expect.poll(async () => (await serverColumns()).find((c) => c.name === doneName)?.is_visible).toBe(true)

    // The status editor opens from the menu.
    await page.getByLabel(`Column options for ${doingName}`).click()
    await page.getByRole('button', { name: 'Edit statuses…' }).click()
    await expect(page.getByRole('dialog', { name: 'Statuses' })).toBeVisible()
})

// LAM-142 (QA finding P4): the column menu is a popover in a portal, so the
// column's scroll area cannot clip it.
test('the column menu is not clipped, closes on Escape and outside click, and only one is open', async ({ page, context, baseURL }) => {
    const alice = await newAccount('popover')
    const world = await projectOf(alice)
    const [todoName, doingName] = world.statusNames
    const board = await boardOf(alice, world)

    await signedInAs(context, alice, baseURL!)
    await page.goto(`/boards/${board.id}`)
    await expect(column(page, todoName)).toBeVisible()

    const first = page.getByRole('button', { name: `Column options for ${todoName}` })
    const second = page.getByRole('button', { name: `Column options for ${doingName}` })
    const panel = (name: string) => page.getByRole('dialog', { name: `Column ${name}` })

    // Open: fully inside the viewport, outside the column, with no scrollbar of its own.
    await first.click()
    await expect(first).toHaveAttribute('aria-expanded', 'true')
    await expect(panel(todoName)).toBeVisible()
    const inside = await panel(todoName).evaluate((el) => {
        const r = el.getBoundingClientRect()
        const column = el.closest('[role="region"]')
        return {
            fits: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
            noScroll: el.scrollHeight <= el.clientHeight,
            inColumn: column !== null,
        }
    })
    expect(inside).toEqual({ fits: true, noScroll: true, inColumn: false })

    // Escape closes it and focus goes back to the button.
    await page.keyboard.press('Escape')
    await expect(panel(todoName)).toHaveCount(0)
    await expect(first).toBeFocused()
    await expect(first).toHaveAttribute('aria-expanded', 'false')

    // Opening another closes the first.
    await first.click()
    await expect(panel(todoName)).toBeVisible()
    await second.click()
    await expect(panel(doingName)).toBeVisible()
    await expect(panel(todoName)).toHaveCount(0)

    // An outside click closes it.
    await page.getByRole('heading', { name: board.name }).click()
    await expect(panel(doingName)).toHaveCount(0)
})
