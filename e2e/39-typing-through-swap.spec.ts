import type { Page } from '@playwright/test'

import { connectionIs, expect, newAccount, openProject, projectOf, signedInAs, test } from './support/app'

// LAM-169: text typed with real keystrokes into a new row's fields right after
// creating it is kept through the temporary-id -> real-id swap, and after a
// reload. The create's response is held back so the swap lands in the middle of
// the typing. (`fill` sets the value in one go and never hit this.)

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const HOLD_MS = 1500

// Holds every POST to `path` for HOLD_MS before sending it on.
async function slowCreate(page: Page, path: string) {
    await page.route(`**${path}`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback()
        await new Promise((resolve) => setTimeout(resolve, HOLD_MS))
        await route.fallback()
    })
}

// Types `text` one key at a time, slowly enough for the swap to land inside it.
async function typeThrough(page: Page, label: string, text: string) {
    const field = page.getByLabel(label, { exact: true })
    await field.click()
    await field.pressSequentially(text, { delay: 120 })
}

async function typeIntoEditor(page: Page, name: string, text: string) {
    const editor = page.getByRole('textbox', { name })
    await editor.click()
    await page.keyboard.type(text, { delay: 120 })
}

test('a new document keeps its title and text typed through the id swap', async ({ page, context, baseURL }) => {
    const account = await newAccount('swapdoc')
    await signedInAs(context, account, baseURL!)
    await page.goto('/documents')
    await connectionIs(page, 'Live')
    await slowCreate(page, '/api/v1/documents')

    await page.getByRole('button', { name: 'New document' }).click()
    await expect(page).toHaveURL(/\/documents\/tmp_/)
    await typeThrough(page, 'Title', 'Quarterly planning notes for the whole team')
    await typeIntoEditor(page, 'Text', 'Agenda and decisions')

    await expect(page).toHaveURL(new RegExp(`/documents/${UUID}$`))
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Quarterly planning notes for the whole team')
    await expect(page.getByRole('textbox', { name: 'Text' })).toContainText('Agenda and decisions')
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()

    await page.reload()
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Quarterly planning notes for the whole team')
    await expect(page.getByRole('textbox', { name: 'Text' })).toContainText('Agenda and decisions')
})

test('a new ticket keeps its description typed through the id swap', async ({ page, context, baseURL }) => {
    const account = await newAccount('swapticket')
    const world = await projectOf(account)
    await signedInAs(context, account, baseURL!)
    await openProject(page, world)
    await connectionIs(page, 'Live')
    await slowCreate(page, '/api/v1/tickets')

    await page.getByRole('button', { name: 'New ticket' }).click()
    const dialog = page.getByRole('dialog', { name: 'New ticket' })
    await dialog.getByLabel('Title').fill('Typed through')
    await dialog.getByRole('button', { name: 'Create ticket' }).click()
    await expect(page).toHaveURL(/\/tickets\/tmp_/)
    await typeThrough(page, 'Title', ' and more words after the title')
    await typeIntoEditor(page, 'Description', 'Written while the server answers')

    await expect(page).toHaveURL(new RegExp(`/tickets/${UUID}$`))
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Typed through and more words after the title')
    await expect(page.getByRole('textbox', { name: 'Description' })).toContainText('Written while the server answers')

    await page.waitForTimeout(2000)
    await page.reload()
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Typed through and more words after the title')
    await expect(page.getByRole('textbox', { name: 'Description' })).toContainText('Written while the server answers')
})

for (const [kind, path] of [
    ['epic', 'epics'],
    ['milestone', 'milestones'],
] as const) {
    test(`a new ${kind} keeps its description typed through the id swap`, async ({ page, context, baseURL }) => {
        const account = await newAccount(`swap${kind}`)
        const world = await projectOf(account)
        await signedInAs(context, account, baseURL!)
        await openProject(page, world)
        await connectionIs(page, 'Live')
        await slowCreate(page, `/api/v1/${path}`)

        await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: `${kind[0].toUpperCase()}${kind.slice(1)}s` }).click()
        await page.getByRole('button', { name: `New ${kind}` }).last().click()
        const dialog = page.getByRole('dialog', { name: `New ${kind}` })
        await dialog.getByLabel('Name').fill('Typed through')
        await dialog.getByRole('button', { name: `Create ${kind}` }).click()
        await expect(page).toHaveURL(new RegExp(`/${path}/tmp_`))
        await typeThrough(page, 'Description', 'Written while the server answers')

        await expect(page).toHaveURL(new RegExp(`/${path}/${UUID}$`))
        await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Written while the server answers')

        await page.waitForTimeout(2000)
        await page.reload()
        await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Written while the server answers')
    })
}
