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

    // Sorting stays reachable from the toolbar.
    await expect(page.getByLabel('Sort by')).toBeVisible()

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
