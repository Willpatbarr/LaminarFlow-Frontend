import { connectionIs, expect, fields, newAccount, openTicket, projectOf, serverCreate, serverTicket, signedInAs, test } from './support/app'

// LAM-130 (QA finding B1): text typed into the ticket title or description, or
// into a milestone description, is kept without ever leaving the field. The
// page says "Changes are saved as you make them", so a reload ~2 s after the
// last keystroke must show it.

test('ticket title and description typed without leaving the field survive a reload', async ({ page, context, baseURL }) => {
    const account = await newAccount('typing')
    const world = await projectOf(account)
    const ticket = await serverCreate(account, world.projectId, fields('Typed ticket'))
    await signedInAs(context, account, baseURL!)
    await openTicket(page, ticket.id, 'Typed ticket')
    await connectionIs(page, 'Live')

    await page.getByLabel('Title').fill('Typed ticket, renamed')
    const description = page.getByRole('textbox', { name: 'Description' })
    await description.click()
    await page.keyboard.type('Written without blurring')
    // No blur, no click elsewhere.
    await page.waitForTimeout(2000)
    await page.reload()

    await expect(page.getByLabel('Title')).toHaveValue('Typed ticket, renamed')
    await expect(page.getByRole('textbox', { name: 'Description' })).toContainText('Written without blurring')
    await expect
        .poll(async () => {
            const t = await serverTicket(account, ticket.id)
            return [t?.title, t?.description]
        })
        .toEqual(['Typed ticket, renamed', 'Written without blurring'])
})

test('a milestone description typed without leaving the field survives a reload', async ({ page, context, baseURL }) => {
    const account = await newAccount('typingms')
    const world = await projectOf(account)
    const milestone = (
        await account.api.POST('/api/v1/milestones', { body: { project_id: world.projectId, name: 'v1.0', description: '' } })
    ).data!
    await signedInAs(context, account, baseURL!)
    await page.goto(`/milestones/${milestone.id}`)
    await expect(page.getByRole('heading', { name: 'v1.0' })).toBeVisible()
    await connectionIs(page, 'Live')

    await page.getByLabel('Description').fill('Ship it in March')
    await page.waitForTimeout(2000)
    await page.reload()

    await expect(page.getByLabel('Description')).toHaveValue('Ship it in March')
    await expect
        .poll(async () => {
            const list = (await account.api.POST('/api/v1/milestones/list', { body: { project_id: world.projectId } })).data?.items ?? []
            return list.find((m) => m.id === milestone.id)?.description
        })
        .toBe('Ship it in March')
})
