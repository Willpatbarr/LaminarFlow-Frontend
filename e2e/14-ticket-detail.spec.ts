import {
    connectionIs,
    expect,
    expectProperty,
    fields,
    newAccount,
    openProject,
    openLabels,
    openTicket,
    pickProperty,
    property,
    projectOf,
    serverCreate,
    serverTicket,
    signedInAs,
    test,
} from './support/app'

// LAM-103: the ticket page sets every field, and a reload shows them all.

test('every field set on the ticket page reaches the server and survives a reload', async ({ page, context, baseURL }) => {
    const account = await newAccount('detail')
    const world = await projectOf(account)
    const api = account.api

    // What the pickers offer: made server-side, because creating them is not this page's job.
    const epic = (await api.POST('/api/v1/epics', { body: { project_id: world.projectId, name: 'Checkout' } })).data!
    const sprint = (await api.POST('/api/v1/sprints', { body: { project_id: world.projectId, name: 'Sprint 1' } })).data!
    const milestone = (await api.POST('/api/v1/milestones', { body: { project_id: world.projectId, name: 'v1.0' } })).data!
    const bug = (await api.POST('/api/v1/labels', { body: { team_id: world.teamId, name: 'bug', color: 'rust' } })).data!
    const ui = (await api.POST('/api/v1/labels', { body: { team_id: world.teamId, name: 'ui', color: 'blue' } })).data!
    expect([epic, sprint, milestone, bug, ui].every(Boolean)).toBe(true)

    const ticket = await serverCreate(account, world.projectId, fields('Detail page'))
    await signedInAs(context, account, baseURL!)
    await openTicket(page, ticket.id, 'Detail page')
    await connectionIs(page, 'Connected')

    // Everything unset reads "None", not an error.
    for (const name of ['Epic', 'Sprint', 'Milestone']) await expectProperty(page, name, 'None')

    await page.getByLabel('Title').fill('Detail page, renamed')
    await page.getByLabel('Title').blur()
    await page.getByRole('textbox', { name: 'Description' }).fill('Everything on one page')
    await page.getByRole('textbox', { name: 'Description' }).blur()
    await pickProperty(page, 'Status', world.statusNames[1])
    await pickProperty(page, 'Assignee', `${account.displayName} (you)`)
    await pickProperty(page, 'Epic', 'Checkout')
    await pickProperty(page, 'Sprint', 'Sprint 1')
    await pickProperty(page, 'Milestone', 'v1.0')
    // Labels: the list stays open while several are ticked.
    const labelList = await openLabels(page)
    await labelList.getByRole('option', { name: 'bug' }).click()
    await labelList.getByRole('option', { name: 'ui' }).click()
    await page.keyboard.press('Escape')

    // On the server: the ticket fields, and the sprint through its filter.
    await expect
        .poll(async () => {
            const t = await serverTicket(account, ticket.id)
            const members = await api.POST('/api/v1/tickets/list', {
                body: { filter: { op: 'and', conditions: [{ field: 'sprint', op: 'eq', value: sprint.id }] } },
            })
            return {
                title: t?.title,
                description: t?.description,
                status_id: t?.status_id,
                assigned: t?.assignee_id === account.accountId,
                epic_id: t?.epic_id,
                milestone_id: t?.milestone_id,
                label_ids: t?.label_ids,
                sprint: (members.data?.items ?? []).map((m) => m.id),
            }
        })
        .toEqual({
            title: 'Detail page, renamed',
            description: 'Everything on one page',
            status_id: world.statusIds[1],
            assigned: true,
            epic_id: epic.id,
            milestone_id: milestone.id,
            label_ids: [bug.id, ui.id].sort(),
            sprint: [ticket.id],
        })

    const shown = async () => {
        await expect(page.getByLabel('Title')).toHaveValue('Detail page, renamed')
        await expect(page.getByRole('textbox', { name: 'Description' })).toHaveText('Everything on one page')
        await expectProperty(page, 'Status', world.statusNames[1])
        await expectProperty(page, 'Assignee', `${account.displayName} (you)`)
        await expectProperty(page, 'Epic', 'Checkout')
        await expectProperty(page, 'Sprint', 'Sprint 1')
        await expectProperty(page, 'Milestone', 'v1.0')
        const chips = page.getByRole('list', { name: 'Labels' })
        await expect(chips.getByText('bug')).toBeVisible()
        await expect(chips.getByText('ui')).toBeVisible()

        // LAM-172: a label's dot is its hue token, not a raw colour.
        const list = await openLabels(page)
        for (const [name, hue] of [['bug', 'rust'], ['ui', 'blue']]) {
            await expect(list.getByRole('option', { name, exact: true })).toHaveAttribute('aria-selected', 'true')
            const dot = list.getByRole('option', { name, exact: true }).locator('.picker__dot')
            const painted = await dot.evaluate((el) => getComputedStyle(el).backgroundColor)
            const token = await page.evaluate((h) => {
                const probe = document.createElement('i')
                probe.style.background = `var(--${h})`
                document.body.append(probe)
                const colour = getComputedStyle(probe).backgroundColor
                probe.remove()
                return colour
            }, hue)
            expect(painted).toBe(token)
        }
        await page.keyboard.press('Escape')
    }
    await shown()

    // Reload: all of it is still there.
    await page.reload()
    await expect(page.getByLabel('Title')).toHaveValue('Detail page, renamed')
    await shown()

    // And "None" again clears them.
    await pickProperty(page, 'Epic', 'None')
    await (await openLabels(page)).getByRole('option', { name: 'bug', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await serverTicket(account, ticket.id))?.epic_id).toBeNull()
    await expect.poll(async () => (await serverTicket(account, ticket.id))?.label_ids).toEqual([ui.id])
})

test('the list opens a ticket in a side panel, and a reload keeps it open', async ({ page, context, baseURL }) => {
    const account = await newAccount('panel')
    const world = await projectOf(account)
    const ticket = await serverCreate(account, world.projectId, fields('Panel ticket'))
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)

    await page.getByRole('link', { name: /Panel ticket/ }).click()
    const panel = page.getByRole('complementary', { name: 'Ticket' })
    await expect(panel.getByLabel('Title')).toHaveValue('Panel ticket')
    await expect(page).toHaveURL(new RegExp(`\\?ticket=${ticket.id}`))

    await panel.getByRole('textbox', { name: 'Description' }).fill('Edited in the panel')
    await panel.getByRole('textbox', { name: 'Description' }).blur()
    await expect.poll(async () => (await serverTicket(account, ticket.id))?.description).toBe('Edited in the panel')

    await page.reload()
    await expect(page.getByRole('complementary', { name: 'Ticket' }).getByRole('textbox', { name: 'Description' })).toHaveText('Edited in the panel')

    await page.getByRole('complementary', { name: 'Ticket' }).getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('complementary', { name: 'Ticket' })).toHaveCount(0)
})

// LAM-211: the page reads as an issue, not a form.
test('an epic made inside the Epic picker is given to the ticket, with no loose create buttons', async ({ page, context, baseURL }) => {
    const account = await newAccount('pickercreate')
    const world = await projectOf(account)
    const ticket = await serverCreate(account, world.projectId, fields('Needs an epic'))
    await signedInAs(context, account, baseURL!)
    await openTicket(page, ticket.id, 'Needs an epic')
    await connectionIs(page, 'Connected')

    await expect(page.getByRole('button', { name: /^New (epic|sprint|milestone) for this ticket$/ })).toHaveCount(0)
    await property(page, 'Epic').click()
    await page.getByRole('searchbox', { name: 'Search epic' }).fill('Onb')
    await page.getByRole('button', { name: 'Create new epic…' }).click()
    const dialog = page.getByRole('dialog', { name: 'New epic' })
    await dialog.getByLabel('Name').fill('Onboarding')
    await dialog.getByRole('button', { name: 'Create epic' }).click()

    await expectProperty(page, 'Epic', 'Onboarding')
    await expect.poll(async () => (await serverTicket(account, ticket.id))?.epic_id).not.toBeNull()
})

for (const [kind, size] of [
    ['desktop', { width: 1366, height: 800 }],
    ['tablet', { width: 768, height: 1024 }],
    ['phone', { width: 375, height: 812 }],
] as const) {
    test(`the ticket page is an issue view on a ${kind}: a large title, the text at full width, properties in a panel (desktop) or chips (tablet, phone)`, async ({
        page,
        context,
        baseURL,
    }) => {
        const account = await newAccount(`issueview${kind}`)
        const world = await projectOf(account)
        const ticket = await serverCreate(account, world.projectId, fields('Issue view', { description: 'Some words' }))
        await page.setViewportSize(size)
        await signedInAs(context, account, baseURL!)
        await openTicket(page, ticket.id, 'Issue view')

        // No boxed "Title" field: the title is a large heading you type into.
        await expect(page.locator('label', { hasText: /^Title$/ })).toHaveCount(0)
        const fontSize = await page.getByLabel('Title').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
        expect(fontSize).toBeGreaterThanOrEqual(28)

        const title = (await page.getByLabel('Title').boundingBox())!
        const text = (await page.getByRole('textbox', { name: 'Description' }).boundingBox())!
        const status = (await property(page, 'Status').boundingBox())!
        const labels = (await page.getByRole('button', { name: 'Add label' }).boundingBox())!
        if (kind !== 'desktop') {
            // Narrower than the panel needs (a tablet's content beside its rail, a phone): chips between the title and the text; the text spans the page.
            expect(status.y).toBeGreaterThan(title.y)
            expect(status.y + status.height).toBeLessThanOrEqual(text.y)
            expect(labels.y + labels.height).toBeLessThanOrEqual(text.y)
            expect(text.width).toBeGreaterThan(size.width - 140)
        } else {
            // A panel at the right of the text.
            expect(status.x).toBeGreaterThanOrEqual(text.x + text.width)
            expect(labels.x).toBeGreaterThanOrEqual(text.x + text.width)
        }
        // No sideways scroll.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
}
