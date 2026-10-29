import { connectionIs, expect, fields, newAccount, openTicket, projectOf, serverCreate, signedInAs, test } from './support/app'

// LAM-120: a document is linked to a ticket from the ticket page, the ticket
// is listed on the document, and unlinking removes it from both.

test('link a document from a ticket, see the ticket on the document, and unlink it', async ({ page, context, baseURL }) => {
    const account = await newAccount('links')
    const world = await projectOf(account)
    const ticket = await serverCreate(account, world.projectId, fields('Plan the launch'))
    const made = await account.api.POST('/api/v1/documents', {
        params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: { title: 'Launch runbook', type: 'normal', project_id: world.projectId, body: { content: 'Steps' } },
    })
    expect(made.response.ok).toBe(true)
    const documentId = made.data!.id
    const linkedOnServer = async () =>
        ((await account.api.GET('/api/v1/tickets/{id}', { params: { path: { id: ticket.id } } })).data?.documents ?? []).map((d) => d.id)

    await signedInAs(context, account, baseURL!)
    await openTicket(page, ticket.id, 'Plan the launch')
    await connectionIs(page, 'Live')

    // Link: search the local store, pick, confirm.
    const documents = page.getByRole('region', { name: 'Documents' })
    await expect(documents.getByText('No documents linked.')).toBeVisible()
    await documents.getByRole('button', { name: 'Link a document' }).click()
    const picker = page.getByRole('dialog', { name: 'Link a document' })
    await picker.getByLabel('Search documents').fill('runbook')
    await picker.getByRole('radio', { name: 'Launch runbook' }).check()
    await picker.getByRole('button', { name: 'Link' }).click()
    await expect(documents.getByRole('link', { name: 'Launch runbook' })).toBeVisible()
    await expect.poll(linkedOnServer).toEqual([documentId])

    // The other end: the document lists the ticket.
    await documents.getByRole('link', { name: 'Launch runbook' }).click()
    await expect(page).toHaveURL(new RegExp(`/documents/${documentId}$`))
    const tickets = page.getByRole('region', { name: 'Tickets' })
    await expect(tickets.getByRole('link', { name: 'Plan the launch' })).toBeVisible()

    // Back on the ticket, and still there after a reload.
    await tickets.getByRole('link', { name: 'Plan the launch' }).click()
    await expect(page).toHaveURL(new RegExp(`/tickets/${ticket.id}$`))
    await page.reload()
    await expect(documents.getByRole('link', { name: 'Launch runbook' })).toBeVisible()

    // Unlink: gone here, on the server, and from the document.
    await documents.getByRole('button', { name: 'Unlink Launch runbook' }).click()
    await expect(documents.getByText('No documents linked.')).toBeVisible()
    await expect.poll(linkedOnServer).toEqual([])
    await page.goto(`/documents/${documentId}`)
    await expect(tickets.getByText('No tickets linked.')).toBeVisible()
})

test('a document made from the ticket page is linked, and a link made elsewhere appears live', async ({ page, context, baseURL }) => {
    const account = await newAccount('links-new')
    const world = await projectOf(account)
    const ticket = await serverCreate(account, world.projectId, fields('Write the spec'))
    await signedInAs(context, account, baseURL!)
    await openTicket(page, ticket.id, 'Write the spec')
    await connectionIs(page, 'Live')

    const documents = page.getByRole('region', { name: 'Documents' })
    await documents.getByRole('button', { name: 'New document' }).click()
    const dialog = page.getByRole('dialog', { name: 'New document' })
    await dialog.getByLabel('Title').fill('Spec draft')
    await dialog.getByRole('button', { name: 'Create and link' }).click()
    await expect(documents.getByRole('link', { name: 'Spec draft' })).toBeVisible()
    await expect
        .poll(async () =>
            ((await account.api.GET('/api/v1/tickets/{id}', { params: { path: { id: ticket.id } } })).data?.documents ?? []).map(
                (d) => d.title,
            ),
        )
        .toEqual(['Spec draft'])

    // Linked from another device (here: the API): the change feed brings it in.
    const other = await account.api.POST('/api/v1/documents', {
        params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: { title: 'Linked elsewhere', type: 'normal', project_id: world.projectId, body: { content: '' } },
    })
    const linked = await account.api.POST('/api/v1/tickets/{id}/documents', {
        params: { path: { id: ticket.id } },
        body: { document_id: other.data!.id },
    })
    expect(linked.response.status).toBe(204)
    await expect(documents.getByRole('link', { name: 'Linked elsewhere' })).toBeVisible()
})
