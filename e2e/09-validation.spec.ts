import {
    expect,
    fields,
    newAccount,
    openTicket,
    projectOf,
    serverCreate,
    serverTicket,
    signedInAs,
    test,
} from './support/app'

// The backend puts no length on a ticket's title (the column is `text`, the API
// schema says only "string"). The one limit that reaches a title is the request
// body: the API refuses anything over 1 MiB (huma's default, 413). A title that
// big is what this sends. The client does not stop it first - the field has no
// maxlength - so the server's refusal is what the user meets.
const OVER_THE_LIMIT = 'x'.repeat(1_100_000)

test('a title the server refuses is explained at the title, with the text intact and a way out', async ({
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
    await title.press('Tab')

    await expect(title).toHaveAttribute('aria-invalid', 'true')
    await expect(title).toHaveAccessibleDescription(/too large|too long/i)
    await expect(title).toHaveValue(OVER_THE_LIMIT)
    await expect(page.getByRole('button', { name: '1 change needs attention' })).toBeVisible()
    expect((await serverTicket(account, ticket.id))?.title).toBe('A sensible title')

    // Shortening it is the fix: leaving the field sends it again.
    await title.fill('Short enough')
    await title.press('Tab')

    await expect(title).not.toHaveAttribute('aria-invalid')
    await expect(page.getByRole('button', { name: /needs? attention/ })).toHaveCount(0)
    expect((await serverTicket(account, ticket.id))?.title).toBe('Short enough')
})
