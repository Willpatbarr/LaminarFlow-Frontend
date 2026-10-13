import {
    expect,
    fields,
    newAccount,
    openTicket,
    projectOf,
    queuedChanges,
    serverCreate,
    serverTicket,
    signedInAs,
    test,
} from './support/app'

// The server's length limit on a title is 200 characters (LAM-75). The client
// checks it at the field and queues nothing over it; the server's own 422 is
// still the authority, and still lands on the field when the check is bypassed.
// (The 1 MiB request-body limit, 413, can no longer be reached by typing: a
// title or description that large is over its own limit first. It stays a unit
// test - failures.test.tsx - where the answer can be stubbed.)

const AT_THE_LIMIT = 'x'.repeat(200)
const OVER_THE_LIMIT = 'x'.repeat(212)

test('a title over 200 characters is explained at the field, kept, and not queued; at 200 it is saved', async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('toolong')
    const world = await projectOf(account)
    const ticket = await serverCreate(account, world.projectId, fields('A sensible title'))
    await signedInAs(context, account, baseURL!)
    await openTicket(page, ticket.id, 'A sensible title')

    const title = page.getByLabel('Title')
    await title.fill(OVER_THE_LIMIT)

    // As it is typed: the count, the field marked, the reason.
    await expect(page.getByText('212 / 200')).toBeVisible()
    await expect(title).toHaveAttribute('aria-invalid', 'true')
    await expect(title).toHaveAccessibleDescription(
        /Title can be at most 200 characters; this one is 12 over\./,
    )

    await title.press('Tab')

    // Nothing was queued, nothing was sent, and the text is still theirs.
    expect(await queuedChanges(page)).toBe(0)
    await expect(title).toHaveValue(OVER_THE_LIMIT)
    await expect(title).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByRole('button', { name: /change/ })).toHaveCount(0)
    expect((await serverTicket(account, ticket.id))?.title).toBe('A sensible title')

    // Exactly the limit is fine: leaving the field saves it.
    await title.fill(AT_THE_LIMIT)
    await expect(page.getByText('200 / 200')).toBeVisible()
    await expect(title).not.toHaveAttribute('aria-invalid')
    await title.press('Tab')

    await expect.poll(async () => (await serverTicket(account, ticket.id))?.title).toBe(AT_THE_LIMIT)
    await expect(page.getByRole('button', { name: /change/ })).toHaveCount(0)
})

test("the server's own refusal still lands on the title when the client's check is bypassed", async ({
    page,
    context,
    baseURL,
}) => {
    const account = await newAccount('bypassed')
    const world = await projectOf(account)
    const ticket = await serverCreate(account, world.projectId, fields('A sensible title'))
    await signedInAs(context, account, baseURL!)
    await openTicket(page, ticket.id, 'A sensible title')

    // The page's check passes (the title it holds is short); the request that
    // leaves the browser is rewritten to carry 201 characters, as a build with
    // an older idea of the limit would have sent it.
    const rewrite = async (route: import('@playwright/test').Route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>
        await route.continue({ postData: JSON.stringify({ ...body, title: 'x'.repeat(201) }) })
    }
    await page.route(`**/api/v1/tickets/${ticket.id}`, async (route) => {
        if (route.request().method() === 'PUT') await rewrite(route)
        else await route.fallback()
    })

    const title = page.getByLabel('Title')
    await title.fill('Short enough for the client')
    await title.press('Tab')

    await expect(title).toHaveAttribute('aria-invalid', 'true')
    await expect(title).toHaveAccessibleDescription(/The server didn't accept this title: .*200/)
    await expect(title).toHaveValue('Short enough for the client')
    await expect(page.getByRole('button', { name: '1 change needs attention' })).toBeVisible()
    expect((await serverTicket(account, ticket.id))?.title).toBe('A sensible title')

    // Fixing it is the way out: with the rewrite gone, leaving the field sends it again.
    await page.unroute(`**/api/v1/tickets/${ticket.id}`)
    await title.fill('Fixed')
    await title.press('Tab')

    await expect(title).not.toHaveAttribute('aria-invalid')
    await expect(page.getByRole('button', { name: /needs? attention/ })).toHaveCount(0)
    await expect.poll(async () => (await serverTicket(account, ticket.id))?.title).toBe('Fixed')
})
