import { connectionIs, expect, newAccount, projectOf, signedInAs, test } from './support/app'

// LAM-121: select text, ask for a review, and the second user answers it. The
// marker shows for both while the request is open and clears for both once it
// is approved.

async function documentWith(owner: Awaited<ReturnType<typeof newAccount>>, projectId: string, content: string) {
    const made = await owner.api.POST('/api/v1/documents', {
        params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: { title: 'Launch plan', type: 'normal', project_id: projectId, body: { content } },
    })
    expect(made.response.ok).toBe(true)
    return made.data!.id
}

test('one user requests a review on a paragraph, a second user approves it, and the marker clears', async ({
    page,
    context,
    browser,
    baseURL,
}) => {
    const alice = await newAccount('alice')
    const bob = await newAccount('bob')
    const world = await projectOf(alice)
    const documentId = await documentWith(alice, world.projectId, 'Please look over this paragraph.')

    await signedInAs(context, alice, baseURL!)
    const bobContext = await browser.newContext()
    await signedInAs(bobContext, bob, baseURL!)
    const bobPage = await bobContext.newPage()
    for (const p of [page, bobPage]) {
        await p.goto(`/documents/${documentId}`)
        await expect(p.getByLabel('Title')).toHaveValue('Launch plan')
        await connectionIs(p, 'Live')
    }

    // Nothing is selected, so there is nothing to ask about yet.
    const ask = page.getByRole('button', { name: 'Request review' })
    await expect(ask).toBeDisabled()

    // Select the paragraph, then ask Bob.
    await page.getByRole('textbox', { name: 'Text' }).click({ clickCount: 3 })
    await expect(ask).toBeEnabled()
    await ask.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Please look over this paragraph.', { exact: false })).toBeVisible()
    await dialog.getByRole('textbox', { name: 'Note for the reviewers' }).fill('Is the tone right?')
    await dialog.getByRole('checkbox', { name: new RegExp(bob.displayName) }).check()
    await dialog.getByRole('button', { name: 'Request review' }).click()

    // The marker and the count appear for Alice, and live for Bob.
    await expect(page.getByRole('button', { name: /1 open review request/ })).toBeVisible()
    await expect(page.getByRole('note')).toHaveText('1 open review request')
    await expect(bobPage.getByRole('button', { name: /1 open review request/ })).toBeVisible()
    await expect(bobPage.getByText(`Review requested by ${alice.displayName}`)).toBeVisible()

    // The server holds the range and the quoted text.
    const onServer = async () =>
        (await alice.api.POST('/api/v1/review-requests/list', { body: { filter: { op: 'and', conditions: [{ field: 'document_id', op: 'eq', value: documentId }] }, } })).data?.items ?? []
    const [made] = await onServer()
    expect(made).toMatchObject({ region_start: 0, region_end: 32, anchor_text: 'Please look over this paragraph.', review_status: 'pending' })

    // It is in Bob's "Needs my review" list and counted in his sidebar.
    await expect(bobPage.getByRole('link', { name: /Needs my review/ })).toContainText('1')
    await bobPage.getByRole('link', { name: /Needs my review/ }).click()
    await expect(bobPage.getByRole('link', { name: 'Launch plan' })).toBeVisible()
    await bobPage.getByRole('link', { name: 'Launch plan' }).click()

    // Alice is not a reviewer, so she is offered no answer; Bob is.
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0)
    await bobPage.getByRole('button', { name: 'Approve' }).click()

    // The marker clears on both screens, and the server agrees.
    await expect(bobPage.getByRole('button', { name: /open review request/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /open review request/ })).toHaveCount(0)
    await expect(page.getByRole('note')).toHaveCount(0)
    await expect(bobPage.getByRole('link', { name: /Needs my review/ })).not.toContainText('1')
    await expect.poll(async () => (await alice.api.POST('/api/v1/review-requests/list', { body: { filter: { op: 'and', conditions: [{ field: 'document_id', op: 'eq', value: documentId }, { field: 'review_status', op: 'eq', value: 'approved' }] } } })).data?.items?.length).toBe(1)
})

test('offsets count characters, not UTF-16 units: a selection after emoji lands on the right words', async ({ page, context, baseURL }) => {
    const alice = await newAccount('alice-emoji')
    const bob = await newAccount('bob-emoji')
    const world = await projectOf(alice)
    // 🚀 and 🎉 are one character each on the server and two units in JavaScript.
    const documentId = await documentWith(alice, world.projectId, '🚀🎉 Ship it Friday')

    await signedInAs(context, alice, baseURL!)
    await page.goto(`/documents/${documentId}`)
    await expect(page.getByLabel('Title')).toHaveValue('Launch plan')
    await connectionIs(page, 'Live')

    await page.getByRole('textbox', { name: 'Text' }).click({ clickCount: 3 })
    await page.getByRole('button', { name: 'Request review' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: 'Note for the reviewers' }).fill('Check the date')
    await dialog.getByRole('checkbox', { name: new RegExp(bob.displayName) }).check()
    await dialog.getByRole('button', { name: 'Request review' }).click()
    await expect(page.getByRole('button', { name: /1 open review request/ })).toBeVisible()

    const list = await alice.api.POST('/api/v1/review-requests/list', {
        body: { filter: { op: 'and', conditions: [{ field: 'document_id', op: 'eq', value: documentId }] } },
    })
    const [made] = list.data!.items!
    // 2 emoji + " Ship it Friday" (15) = 17 characters; 19 UTF-16 units.
    expect(made).toMatchObject({ region_start: 0, region_end: 17, anchor_text: '🚀🎉 Ship it Friday' })
})

test('a comment shows its author by name', async ({ page, context, browser, baseURL }) => {
    const alice = await newAccount('alice-name')
    const bob = await newAccount('bob-name')
    const world = await projectOf(alice)
    const documentId = await documentWith(alice, world.projectId, 'Notes')
    const posted = await alice.api.POST('/api/v1/comments', {
        params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: { document_id: documentId, body: 'From Alice' },
    })
    expect(posted.response.ok).toBe(true)

    await signedInAs(context, bob, baseURL!)
    await page.goto(`/documents/${documentId}`)
    const thread = page.getByRole('region', { name: /Comments/ })
    await expect(thread.getByText('From Alice')).toBeVisible()
    await expect(thread.getByText(alice.displayName)).toBeVisible()
    void browser
})
