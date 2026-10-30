import { connectionIs, expect, fields, newAccount, openTicket, projectOf, serverCreate, signedInAs, test, unique } from './support/app'

// LAM-112: a comment thread on the ticket and the document page. A comment is
// posted through the outbox and seen live by a second browser; only its author
// can edit or delete it.

test('a comment posted in one browser appears live in another account\'s, who cannot edit or delete it', async ({
    page,
    context,
    browser,
    baseURL,
}) => {
    const alice = await newAccount('alice')
    const bob = await newAccount('bob')
    const world = await projectOf(alice)
    const ticket = await serverCreate(alice, world.projectId, fields('Talk about it'))
    const commentsOnServer = async () =>
        (
            await alice.api.POST('/api/v1/comments/list', {
                body: { filter: { op: 'and', conditions: [{ field: 'ticket_id', op: 'eq', value: ticket.id }] } },
            })
        ).data?.items?.map((c) => c.body) ?? []

    await signedInAs(context, alice, baseURL!)
    const bobContext = await browser.newContext()
    await signedInAs(bobContext, bob, baseURL!)
    const bobPage = await bobContext.newPage()
    await openTicket(page, ticket.id, 'Talk about it')
    await openTicket(bobPage, ticket.id, 'Talk about it')
    await connectionIs(page, 'Connected')
    await connectionIs(bobPage, 'Connected')

    const mine = page.getByRole('region', { name: /Comments/ })
    const theirs = bobPage.getByRole('region', { name: /Comments/ })
    await expect(mine.getByText('No comments yet.')).toBeVisible()

    // Alice posts: it is on her screen at once, on the server, and live on Bob's.
    await mine.getByRole('textbox', { name: 'Add a comment' }).fill('Ship it on Friday')
    await mine.getByRole('button', { name: 'Comment' }).click()
    await expect(mine.getByRole('listitem').getByText('You')).toBeVisible()
    await expect(mine.getByText('Friday')).toBeVisible()
    await expect.poll(commentsOnServer).toEqual(['Ship it on Friday'])
    await expect(theirs.getByText('Friday')).toBeVisible()
    // Bob sees Alice by her display name (LAM-121), not as "Someone else".
    await expect(theirs.getByRole('listitem').getByText(alice.displayName)).toBeVisible()

    // The composer is empty again; Bob has no way to change Alice's comment.
    await expect(mine.getByRole('textbox', { name: 'Add a comment' })).toHaveText('')
    await expect(theirs.getByRole('button', { name: 'Edit comment' })).toHaveCount(0)
    await expect(theirs.getByRole('button', { name: 'Delete comment' })).toHaveCount(0)

    // Alice edits: Bob sees the new words.
    await mine.getByRole('button', { name: 'Edit comment' }).click()
    const editor = mine.getByRole('textbox', { name: 'Edit comment' })
    await editor.fill('Ship it on Monday')
    await mine.getByRole('button', { name: 'Save' }).click()
    await expect(mine.getByText('Monday')).toBeVisible()
    await expect(theirs.getByText('Monday')).toBeVisible()
    await expect(theirs.getByText('(edited)')).toBeVisible()
    await expect.poll(commentsOnServer).toEqual(['Ship it on Monday'])

    // Bob replies; Alice sees it live, and can delete only her own.
    await theirs.getByRole('textbox', { name: 'Add a comment' }).fill('Agreed')
    await theirs.getByRole('button', { name: 'Comment' }).click()
    await expect(mine.getByText('Agreed')).toBeVisible()
    const alicesRow = mine.getByRole('listitem').filter({ hasText: 'Monday' })
    const bobsRow = mine.getByRole('listitem').filter({ hasText: 'Agreed' })
    await expect(bobsRow.getByRole('button', { name: 'Delete comment' })).toHaveCount(0)

    // Delete asks first; Bob's screen follows.
    await alicesRow.getByRole('button', { name: 'Delete comment' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    await expect(mine.getByText('Monday')).toBeVisible()
    await alicesRow.getByRole('button', { name: 'Delete comment' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(mine.getByText('Monday')).toHaveCount(0)
    await expect(theirs.getByText('Monday')).toHaveCount(0)
    await expect.poll(commentsOnServer).toEqual(['Agreed'])

    // It is all still there after a reload.
    await page.reload()
    await expect(page.getByLabel('Title')).toHaveValue('Talk about it')
    await expect(mine.getByText('Agreed')).toBeVisible()
})

test('a comment written offline is kept and sent once the network is back', async ({ page, context, baseURL }) => {
    const account = await newAccount('offline-comment')
    const world = await projectOf(account)
    const ticket = await serverCreate(account, world.projectId, fields('Offline talk'))
    const onServer = async () =>
        (
            await account.api.POST('/api/v1/comments/list', {
                body: { filter: { op: 'and', conditions: [{ field: 'ticket_id', op: 'eq', value: ticket.id }] } },
            })
        ).data?.items?.map((c) => c.body) ?? []

    await signedInAs(context, account, baseURL!)
    await openTicket(page, ticket.id, 'Offline talk')
    await connectionIs(page, 'Connected')

    await context.setOffline(true)
    await connectionIs(page, 'Offline')
    const thread = page.getByRole('region', { name: /Comments/ })
    await thread.getByRole('textbox', { name: 'Add a comment' }).fill('Written on a train')
    await thread.getByRole('button', { name: 'Comment' }).click()
    await expect(thread.getByText('Written on a train')).toBeVisible()
    expect(await onServer()).toEqual([])

    await context.setOffline(false)
    await expect.poll(onServer).toEqual(['Written on a train'])
    await expect(thread.getByText('Sending…')).toHaveCount(0)
})

test('a document page has its own thread, for a normal document and an aspect one', async ({ page, context, baseURL }) => {
    const account = await newAccount('doc-comments')
    const world = await projectOf(account)
    const made = await account.api.POST('/api/v1/documents', {
        params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: { title: 'Runbook', type: 'normal', project_id: world.projectId, body: { content: 'Steps' } },
    })
    expect(made.response.ok).toBe(true)
    const documentId = made.data!.id

    await signedInAs(context, account, baseURL!)
    await page.goto(`/documents/${documentId}`)
    await expect(page.getByLabel('Title')).toHaveValue('Runbook')
    await connectionIs(page, 'Connected')

    const thread = page.getByRole('region', { name: /Comments/ })
    await thread.getByRole('textbox', { name: 'Add a comment' }).fill('Step 3 is out of date')
    await thread.getByRole('button', { name: 'Comment' }).click()
    await expect(thread.getByText('Step 3 is out of date')).toBeVisible()
    await expect
        .poll(async () =>
            (
                await account.api.POST('/api/v1/comments/list', {
                    body: { filter: { op: 'and', conditions: [{ field: 'document_id', op: 'eq', value: documentId }] } },
                })
            ).data?.items?.map((c) => c.body),
        )
        .toEqual(['Step 3 is out of date'])

    // An aspect document is the same page with labeled fields: the thread is there too.
    const type = await account.api.POST('/api/v1/aspect-types', { body: { team_id: world.teamId, name: unique('Spec') } })
    const field = await account.api.POST('/api/v1/aspect-types/{id}/fields', {
        params: { path: { id: type.data!.id } },
        body: { label: 'Summary' },
    })
    expect(field.response.ok).toBe(true)
    const aspect = await account.api.POST('/api/v1/documents', {
        params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: { title: 'Typed', type: 'aspect', aspect_type_id: type.data!.id, project_id: world.projectId, body: {} },
    })
    expect(aspect.response.ok).toBe(true)
    await page.goto(`/documents/${aspect.data!.id}`)
    await expect(page.getByRole('textbox', { name: 'Summary' })).toBeVisible()
    const aspectThread = page.getByRole('region', { name: /Comments/ })
    await aspectThread.getByRole('textbox', { name: 'Add a comment' }).fill('Summary needs an example')
    await aspectThread.getByRole('button', { name: 'Comment' }).click()
    await expect(aspectThread.getByText('Summary needs an example')).toBeVisible()
})
