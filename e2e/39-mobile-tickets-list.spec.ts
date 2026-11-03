import { expect, fields, newAccount, openProject, projectOf, serverCreate, signedInAs, test } from './support/app'

// LAM-140: at phone width each ticket row stacks (title on its own line, chips
// and avatar under it) instead of fixed columns printing over each other.
test.use({ viewport: { width: 375, height: 812 } })

test('rows stack: long titles are visible and wrap, nothing overlaps, no sideways scroll, sort and archive stay reachable', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('mobilelist')
    const world = await projectOf(account)
    const long = 'A rather long ticket title that has to wrap onto more than one line on a phone screen'
    await serverCreate(account, world.projectId, fields(long, { status_id: world.statusIds[0] }))
    await serverCreate(account, world.projectId, fields('Short one', { status_id: world.statusIds[0] }))
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)

    const group = page.getByRole('region', { name: world.statusNames[0] })
    const rowLong = group.getByRole('link', { name: new RegExp(long) })
    const rowShort = group.getByRole('link', { name: /Short one/ })
    await expect(rowLong).toBeVisible()
    await expect(rowShort).toBeVisible()

    // The title is shown whole: it wraps (taller than one line) and is not cut.
    const title = rowLong.getByText(long)
    const titleBox = (await title.boundingBox())!
    expect(titleBox.width).toBeGreaterThan(100)
    expect(titleBox.height).toBeGreaterThan(20)
    expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)

    // The status chip is on a line below the title, and the row's own box
    // holds it (no overlap with the title).
    const pill = rowLong.locator('.chip').first()
    const pillBox = (await pill.boundingBox())!
    expect(pillBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1)

    // The column header row is gone, so its labels cannot print over each other.
    await expect(page.locator('.table__header')).toBeHidden()
    await expect(page.locator('.table-head')).toBeHidden()

    // Sorting stays reachable: the View button opens a sheet with it (LAM-212).
    await page.getByRole('button', { name: /^View/ }).click()
    await expect(page.getByRole('dialog', { name: 'View' }).getByLabel('Sort by')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'View' })).toHaveCount(0)

    // Row actions stay reachable, below the title and inside the viewport.
    const archive = group.getByRole('button', { name: `Archive ${long}` })
    await expect(archive).toBeVisible()
    const archiveBox = (await archive.boundingBox())!
    expect(archiveBox.x + archiveBox.width).toBeLessThanOrEqual(375)
    expect(archiveBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1)
    // Touch has no hover, so the quiet row buttons are at full strength.
    const strong = await archive.evaluate((el) => getComputedStyle(el).color)
    const text = await page.getByRole('heading', { name: 'Tickets', exact: true }).evaluate((el) => getComputedStyle(el).color)
    expect(strong).toBe(text)
    await archive.focus()
    await expect(archive).toBeFocused()

    // No sideways page scroll.
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    expect(fits).toBe(true)
})

// LAM-212: the header is one slim bar (New ticket as an icon, Save view and Edit
// statuses in a ⋯ menu, Search beside a View button) so the first ticket starts
// in the top third of the screen, and every control it folded away still works.
test('the header is slim: the first ticket starts in the top third; the ⋯ menu and the View sheet hold the rest', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('mobilehead')
    const world = await projectOf(account)
    await serverCreate(account, world.projectId, fields('First one', { status_id: world.statusIds[0] }))
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)

    const row = page.getByRole('link', { name: /First one/ })
    await expect(row).toBeVisible()
    // Top third on a one-project account (measured 259px of 812); this account has a second project, so the
    // project picker adds a row.
    expect((await row.boundingBox())!.y).toBeLessThan(812 * 0.4)

    // The page heading is not drawn (the top bar says it), but the page keeps its h1.
    const heading = page.getByRole('heading', { name: 'Tickets', level: 1 })
    expect((await heading.boundingBox())!.width).toBeLessThanOrEqual(1)
    await expect(page.locator('.app-shell__topbar')).toContainText('Tickets')

    // New ticket is an icon button with its name; the folded actions are not on the bar.
    const newTicket = page.getByRole('button', { name: 'New ticket' })
    await expect(newTicket).toHaveText('')
    await expect(page.getByRole('button', { name: 'Save view' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Edit statuses' })).toHaveCount(0)
    await expect(page.getByLabel('Group by')).toHaveCount(0)

    await page.getByRole('button', { name: 'More actions' }).click()
    await expect(page.getByRole('menuitem', { name: 'Edit statuses' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Save view' }).click()
    await expect(page.getByRole('dialog', { name: 'Save list view' })).toBeVisible()
    await page.keyboard.press('Escape')

    // The View sheet: group, sort, filter and columns work from it.
    await page.getByRole('button', { name: /^View/ }).click()
    const sheet = page.getByRole('dialog', { name: 'View' })
    await sheet.getByLabel('Group by').selectOption({ label: 'Epic' })
    await expect(page).toHaveURL(/group=epic/)
    await sheet.getByText(/^Filter/).click()
    await expect(sheet.getByRole('group', { name: 'Status' })).toBeVisible()
    await sheet.getByText('Columns').click()
    await expect(sheet.getByRole('group', { name: 'Visible columns' })).toBeVisible()
    await page.keyboard.press('Escape')
    // Something is set, so the closed button says so.
    await expect(page.getByRole('button', { name: /^View/ })).toContainText('1')

    await newTicket.click()
    await expect(page.getByRole('dialog', { name: 'New ticket' })).toBeVisible()
})
