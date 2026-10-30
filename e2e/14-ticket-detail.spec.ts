import {
    connectionIs,
    expect,
    fields,
    newAccount,
    openProject,
    openTicket,
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
    for (const name of ['Epic', 'Sprint', 'Milestone']) await expect(page.getByLabel(name, { exact: true })).toHaveValue('')
    await expect(page.getByLabel('Epic', { exact: true })).toContainText('None')

    await page.getByLabel('Title').fill('Detail page, renamed')
    await page.getByLabel('Title').blur()
    await page.getByRole('textbox', { name: 'Description' }).fill('Everything on one page')
    await page.getByRole('textbox', { name: 'Description' }).blur()
    await page.getByLabel('Status').selectOption({ label: world.statusNames[1] })
    await page.getByLabel('Assignee').selectOption({ label: `${account.displayName} (you)` })
    await page.getByLabel('Epic', { exact: true }).selectOption({ label: 'Checkout' })
    await page.getByLabel('Sprint', { exact: true }).selectOption({ label: 'Sprint 1' })
    await page.getByLabel('Milestone', { exact: true }).selectOption({ label: 'v1.0' })
    await page.getByRole('checkbox', { name: 'bug' }).check()
    await page.getByRole('checkbox', { name: 'ui' }).check()

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
        await expect(page.getByLabel('Status')).toHaveValue(world.statusIds[1])
        await expect(page.getByLabel('Assignee')).toHaveValue(account.accountId)
        await expect(page.getByLabel('Epic', { exact: true })).toHaveValue(epic.id)
        await expect(page.getByLabel('Sprint', { exact: true })).toHaveValue(sprint.id)
        await expect(page.getByLabel('Milestone', { exact: true })).toHaveValue(milestone.id)
        await expect(page.getByRole('checkbox', { name: 'bug' })).toBeChecked()
        await expect(page.getByRole('checkbox', { name: 'ui' })).toBeChecked()

        // LAM-172: a label's dot is its hue token, not a raw colour.
        for (const [name, hue] of [['bug', 'rust'], ['ui', 'blue']]) {
            const dot = page.locator('label.ticket__label', { hasText: name }).locator('.ticket__label-dot')
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
    }
    await shown()

    // Reload: all of it is still there.
    await page.reload()
    await expect(page.getByLabel('Title')).toHaveValue('Detail page, renamed')
    await shown()

    // And "None" again clears them.
    await page.getByLabel('Epic', { exact: true }).selectOption({ label: 'None' })
    await page.getByRole('checkbox', { name: 'bug' }).uncheck()
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
