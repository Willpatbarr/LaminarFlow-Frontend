import { expect, fields, newAccount, openTicket, projectOf, serverCreate, signedInAs, test } from './support/app'

// LAM-189: on a phone the ticket page has a sticky Details / Comments / Activity
// bar whose links jump to the sections; on a wider screen there is no bar.
test.describe('phone', () => {
    test.use({ viewport: { width: 375, height: 812 } })

    test('the section bar jumps to Comments and Activity, clear of the bars, and focuses the heading', async ({ page, context, baseURL }) => {
        const account = await newAccount('sectionbar')
        const world = await projectOf(account)
        const paragraph = 'The ticket page keeps comments and activity reachable on a phone. '.repeat(4)
        const ticket = await serverCreate(
            account,
            world.projectId,
            fields('Long ticket', { status_id: world.statusIds[0], description: Array(5).fill(paragraph).join('\n\n') }),
        )
        await signedInAs(context, account, baseURL!)
        await openTicket(page, ticket.id, 'Long ticket')

        const bar = page.getByRole('navigation', { name: 'Ticket sections' })
        await expect(bar).toBeVisible()
        const comments = page.getByRole('heading', { name: /^Comments/ })
        // Far below the first screen without the bar.
        expect(await comments.evaluate((el) => el.getBoundingClientRect().top + scrollY)).toBeGreaterThan(812)

        await bar.getByRole('link', { name: /^Comments/ }).click()
        await expect(comments).toBeFocused()
        await expect(comments).toBeInViewport()
        await expect(bar).toBeInViewport()
        const top = await comments.evaluate((el) => el.getBoundingClientRect().top)
        const barBottom = await bar.evaluate((el) => el.getBoundingClientRect().bottom)
        expect(top).toBeGreaterThanOrEqual(barBottom)

        await bar.getByRole('link', { name: 'Activity' }).click()
        await expect(page.getByRole('heading', { name: 'Activity' })).toBeFocused()
        await expect(bar.getByRole('link', { name: 'Activity' })).toHaveAttribute('aria-current', 'location')

        await bar.getByRole('link', { name: 'Details' }).click()
        await expect(page.getByLabel('Title')).toBeFocused()
    })
})

test('on a wide screen there is no section bar', async ({ page, context, baseURL }) => {
    const account = await newAccount('sectionbar-wide')
    const world = await projectOf(account)
    const ticket = await serverCreate(account, world.projectId, fields('Wide ticket', { status_id: world.statusIds[0] }))
    await signedInAs(context, account, baseURL!)
    await openTicket(page, ticket.id, 'Wide ticket')
    await expect(page.getByRole('navigation', { name: 'Ticket sections' })).toBeHidden()
})
