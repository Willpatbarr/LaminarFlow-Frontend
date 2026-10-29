import type { BrowserContext, Page } from '@playwright/test'

import { connectionIs, expect, newAccount, projectOf, signedInAs, test, type Account } from './support/app'

// LAM-166: the document side of 34-online-conflict. A change someone else saves
// while you are typing is a conflict only if it touched a title or body key you
// changed too. Bob saves through the API; Alice's page stays live throughout.

async function setup(page: Page, context: BrowserContext, baseURL: string) {
    const alice = await newAccount('alice')
    const bob = await newAccount('bob')
    const world = await projectOf(alice)
    const made = await alice.api.POST('/api/v1/documents', {
        params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: { title: 'Shared doc', type: 'normal', project_id: world.projectId, body: { content: 'Shared body' } },
    })
    const doc = made.data!
    await signedInAs(context, alice, baseURL)
    await page.goto(`/documents/${doc.id}`)
    await expect(page.getByLabel('Title')).toHaveValue('Shared doc')
    await connectionIs(page, 'Live')
    return { alice, bob, doc }
}

async function serverDoc(account: Account, id: string) {
    return (await account.api.GET('/api/v1/documents/{id}', { params: { path: { id } } })).data!
}

async function bobSaves(bob: Account, id: string, version: number, title: string, content: string) {
    const result = await bob.api.PUT('/api/v1/documents/{id}', {
        params: { path: { id }, header: { 'If-Match': `"${version}"` } },
        body: { title, type: 'normal', body: { content } },
    })
    expect(result.response.ok).toBe(true)
}

const panelOf = (page: Page) => page.getByRole('region', { name: 'This document needs a decision' })
const editorOf = (page: Page) => page.getByRole('textbox', { name: 'Text' })

test('typing in the body while Bob saves the body shows the conflict, and neither text is lost', async ({ page, context, baseURL }) => {
    const { alice, bob, doc } = await setup(page, context, baseURL!)

    await editorOf(page).click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type(' A edit')
    await bobSaves(bob, doc.id, doc.version, 'Shared doc', 'Shared body B edit')

    await expect(panelOf(page)).toBeVisible()
    await expect(panelOf(page)).toContainText('Shared body B edit')
    await expect(panelOf(page)).toContainText('A edit')
    expect((await serverDoc(alice, doc.id)).body.content).toBe('Shared body B edit')
    await expect(editorOf(page)).toContainText('A edit')
})

test('typing in the body while Bob changes the title is no conflict, and both are kept', async ({ page, context, baseURL }) => {
    const { alice, bob, doc } = await setup(page, context, baseURL!)

    await editorOf(page).click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type(' A edit')
    await bobSaves(bob, doc.id, doc.version, 'Bob title', 'Shared body')
    await page.getByLabel('Title').click()

    await expect
        .poll(async () => {
            const d = await serverDoc(alice, doc.id)
            return [d.title, d.body.content]
        })
        .toEqual(['Bob title', 'Shared body A edit'])
    await expect(panelOf(page)).toHaveCount(0)
})

test('a solo edit with several autosaves shows no conflict', async ({ page, context, baseURL }) => {
    const { alice, doc } = await setup(page, context, baseURL!)

    await editorOf(page).click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type(' one')
    await page.waitForTimeout(1500)
    await page.keyboard.type(' two')
    await page.waitForTimeout(1500)
    await page.keyboard.type(' three')
    await page.getByLabel('Title').click()

    await expect.poll(async () => (await serverDoc(alice, doc.id)).body.content).toBe('Shared body one two three')
    await expect(panelOf(page)).toHaveCount(0)
})
