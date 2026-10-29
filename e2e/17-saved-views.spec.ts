import {
    expect,
    fields,
    newAccount,
    projectOf,
    serverCreate,
    signedInAs,
    test,
    type Account,
    type World,
} from './support/app'

// LAM-118: save a filtered board as a team view; a second person opens it from
// the sidebar. Every claim about "saved" reads the server.

async function boardOf(account: Account, world: World) {
    const { data } = await account.api.POST('/api/v1/boards/list', { body: { project_id: world.projectId } })
    const board = data?.items?.[0]
    if (!board) throw new Error('the project has no default board')
    return board
}

const cardsIn = (page: import('@playwright/test').Page, name: string) =>
    page.getByRole('region', { name, exact: true }).getByRole('listitem').getByRole('link').allTextContents()

test('a filtered board saved as a team view opens from a teammate\'s sidebar; a private one stays private', async ({
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
    await serverCreate(alice, world.projectId, fields('Card one', { status_id: todo }))
    await serverCreate(alice, world.projectId, fields('Card two', { status_id: todo }))
    await serverCreate(alice, world.projectId, fields('Card three', { status_id: doing }))
    const board = await boardOf(alice, world)

    // Alice filters the board to the first status and saves it for the team.
    await signedInAs(context, alice, baseURL!)
    await page.goto(`/boards/${board.id}`)
    await expect(page.getByRole('heading', { name: board.name })).toBeVisible()
    await expect.poll(() => cardsIn(page, doingName)).toEqual(['Card three'])

    await page.getByText(/^Filter/).click()
    await page.getByRole('group', { name: 'Board filter' }).getByRole('checkbox', { name: todoName }).check()
    await expect.poll(() => cardsIn(page, doingName)).toEqual([])
    await expect.poll(() => cardsIn(page, todoName)).toEqual(['Card one', 'Card two'])

    const teamView = `Only ${todoName}`
    await page.getByRole('button', { name: 'Save view' }).click()
    const dialog = page.getByRole('dialog', { name: 'Save board view' })
    await dialog.getByLabel('Name').fill(teamView)
    await dialog.getByLabel('The team').check()
    await dialog.getByRole('button', { name: 'Save view' }).click()
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: teamView })).toBeVisible()

    // And a private one, which only Alice may ever see.
    const privateView = 'Alice only'
    await page.getByRole('button', { name: 'Save view' }).click()
    await page.getByRole('dialog', { name: 'Save board view' }).getByLabel('Name').fill(privateView)
    await page.getByRole('dialog', { name: 'Save board view' }).getByRole('button', { name: 'Save view' }).click()

    // The server has both, the team one shared, with the filter and the board.
    const listed = async (account: Account) =>
        ((await account.api.POST('/api/v1/saved-views/list', { body: { team_id: world.teamId } })).data?.items ?? []).filter(
            (view) => view.name === teamView || view.name === privateView,
        )
    await expect.poll(async () => (await listed(alice)).length).toBe(2)
    const saved = (await listed(alice)).find((view) => view.name === teamView)!
    expect(saved).toMatchObject({ layout: 'board', board_id: board.id, is_shared: true })
    expect(saved.config.filter?.conditions).toEqual([{ field: 'status', op: 'in', value: [todo] }])
    expect((await listed(bob)).map((view) => view.name)).toEqual([teamView])

    // Bob, on his own device, opens it from the sidebar of the team.
    const bobContext = await browser.newContext()
    await signedInAs(bobContext, bob, baseURL!)
    const bobPage = await bobContext.newPage()
    await bobPage.goto(`/teams/${world.teamId}`)
    const nav = bobPage.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link', { name: privateView })).toHaveCount(0)
    await nav.getByRole('link', { name: teamView }).click()

    await expect(bobPage.getByRole('heading', { name: board.name })).toBeVisible()
    await expect.poll(() => cardsIn(bobPage, todoName)).toEqual(['Card one', 'Card two'])
    await expect.poll(() => cardsIn(bobPage, doingName)).toEqual([])
    await expect(bobPage.getByText(/has changed/)).toHaveCount(0)

    // Changing the filter shows it as changed, with the way back; Bob does not own it.
    await bobPage.getByRole('button', { name: 'Clear filters' }).click()
    await expect(bobPage.getByText(`“${teamView}” has changed.`)).toBeVisible()
    await expect(bobPage.getByRole('button', { name: 'Save changes' })).toHaveCount(0)
    await bobPage.getByRole('button', { name: 'Revert' }).click()
    await expect(bobPage.getByText(/has changed/)).toHaveCount(0)
    await expect.poll(() => cardsIn(bobPage, doingName)).toEqual([])
})
