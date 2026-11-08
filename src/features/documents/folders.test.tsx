import { cleanup, screen, waitFor, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { connectSyncToSession, sync, wipeLocalData } from '@/sync'
import { doc, docBody, listRoutes } from '@/sync/testing/harness'
import { openApp, startAnonymous } from '@/testing/app'
import { bodyOf, ok } from '@/testing/fetch'

// Document folders through the real route tree, store and engine, with only
// `fetch` stubbed.

let disconnect = () => {}

beforeEach(async () => {
    localStorage.clear()
    await startAnonymous()
    disconnect = connectSyncToSession()
})

afterEach(async () => {
    cleanup()
    disconnect()
    await wipeLocalData()
    vi.unstubAllGlobals()
})

const stamp = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const SPECS = { id: 'f-specs', project_id: 'p-1', parent_id: null, name: 'Specs', ...stamp }
const API = { id: 'f-api', project_id: 'p-1', parent_id: 'f-specs', name: 'API', ...stamp }
const DOCS = [
    doc({ id: 'd-top', title: 'Roadmap', project_id: 'p-1' }),
    doc({ id: 'd-in', title: 'Auth spec', project_id: 'p-1', folder_id: 'f-api' }),
]

function routes(extra: Record<string, (request: Request) => Response | Promise<Response>> = {}) {
    return { ...listRoutes([], DOCS, [], { folders: [SPECS, API] }), ...extra }
}

const folderButton = (name: string) => screen.findByRole('button', { name })

describe('folders on a project\'s Documents tab', () => {
    it('shows folders first, closed, with how many documents are in them, and opens them', async () => {
        await openApp('/projects/p-1/documents', routes())
        const specs = await folderButton('Specs')
        expect(specs).toHaveAttribute('aria-expanded', 'false')
        expect(screen.getByText('1 document')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Roadmap' })).toBeInTheDocument()
        expect(screen.queryByRole('link', { name: 'Auth spec' })).not.toBeInTheDocument()

        const user = userEvent.setup()
        await user.click(specs)
        await user.click(await folderButton('API'))
        expect(await screen.findByRole('link', { name: 'Auth spec' })).toHaveAttribute('href', '/documents/d-in')
        expect(within(screen.getByRole('group', { name: 'In API' })).getByRole('link', { name: 'Auth spec' })).toBeInTheDocument()
    })

    it('New folder makes one at the top level of the project', async () => {
        let sent: unknown
        await openApp(
            '/projects/p-1/documents',
            routes({
                'POST /api/v1/document-folders': async (request) => {
                    sent = await bodyOf(request)
                    return ok({ ...SPECS, id: 'f-new', name: 'Research' })
                },
            }),
        )
        await folderButton('Specs')
        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: 'New folder' }))
        const dialog = await screen.findByRole('dialog', { name: 'New folder' })
        await user.type(within(dialog).getByLabelText('Name'), 'Research')
        await user.click(within(dialog).getByRole('button', { name: 'Create folder' }))

        expect(await folderButton('Research')).toBeInTheDocument()
        await waitFor(() => expect(sent).toEqual({ project_id: 'p-1', parent_id: null, name: 'Research' }))
    })

    it('moves a document into a folder from its ⋯ menu', async () => {
        const puts: Record<string, unknown>[] = []
        await openApp(
            '/projects/p-1/documents',
            routes({
                'PUT /api/v1/documents/d-top': async (request) => {
                    const body = (await bodyOf(request)) as Record<string, unknown>
                    puts.push(body)
                    return ok(docBody({ ...DOCS[0], ...body, version: 2 }))
                },
            }),
        )
        const user = userEvent.setup()
        await screen.findByRole('link', { name: 'Roadmap' })
        await user.click(screen.getByRole('button', { name: 'Actions for Roadmap' }))
        await user.click(await screen.findByRole('menuitem', { name: 'Move to folder…' }))
        const dialog = await screen.findByRole('dialog', { name: 'Move “Roadmap”' })
        await user.selectOptions(within(dialog).getByLabelText('Move to'), 'f-specs')
        await user.click(within(dialog).getByRole('button', { name: 'Move' }))

        await waitFor(() => expect(puts).toHaveLength(1))
        expect(puts[0]).toMatchObject({ folder_id: 'f-specs' })
        // The folder it went into is opened, so it can be seen there.
        expect(await screen.findByRole('group', { name: 'In Specs' })).toBeInTheDocument()
        expect(within(screen.getByRole('group', { name: 'In Specs' })).getByRole('link', { name: 'Roadmap' })).toBeInTheDocument()
    })

    it('deleting a folder says where its contents go and deletes nothing else', async () => {
        let deleted = 0
        await openApp(
            '/projects/p-1/documents',
            routes({
                'DELETE /api/v1/document-folders/f-specs': () => {
                    deleted++
                    return new Response(null, { status: 204 })
                },
            }),
        )
        const user = userEvent.setup()
        await folderButton('Specs')
        await user.click(screen.getByRole('button', { name: 'Actions for folder Specs' }))
        await user.click(await screen.findByRole('menuitem', { name: 'Delete folder…' }))
        const dialog = await screen.findByRole('dialog', { name: 'Delete folder “Specs”?' })
        expect(within(dialog).getByText('Its 1 folder moves to the top level. Nothing is deleted.')).toBeInTheDocument()
        await user.click(within(dialog).getByRole('button', { name: 'Delete folder' }))

        // API, and the document in it, are now at the top level.
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Specs' })).not.toBeInTheDocument())
        expect(screen.getByRole('button', { name: 'API' })).toBeInTheDocument()
        expect(sync.folders.find((folder) => folder.id === 'f-api')?.parent_id).toBeNull()
        await waitFor(() => expect(deleted).toBe(1))
        expect(sync.documents.find((document) => document.id === 'd-in')?.folder_id).toBe('f-api')
    })
})

describe('folders elsewhere', () => {
    it('All projects shows a document\'s folder as a chip, and New folder asks for a project first', async () => {
        await openApp('/documents', routes())
        await screen.findByRole('link', { name: 'Auth spec' })
        expect(screen.getByText('Specs / API')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'New folder' })).toBeDisabled()
    })

    it('the document page has a Folder picker, and a project change takes it out of its folder', async () => {
        const puts: Record<string, unknown>[] = []
        await openApp(
            '/documents/d-in',
            routes({
                'PUT /api/v1/documents/d-in': async (request) => {
                    const body = (await bodyOf(request)) as Record<string, unknown>
                    puts.push(body)
                    return ok(docBody({ ...DOCS[1], ...body, version: puts.length + 1 }))
                },
            }),
        )
        const picker = await screen.findByLabelText('Folder')
        expect(picker).toHaveValue('f-api')
        const user = userEvent.setup()
        await user.selectOptions(picker, '')
        await waitFor(() => expect(puts).toHaveLength(1))
        expect(puts[0]).toMatchObject({ folder_id: null })

        await user.selectOptions(screen.getByLabelText('Project'), '')
        await waitFor(() => expect(puts).toHaveLength(2))
        expect(puts[1]).toMatchObject({ project_id: null, folder_id: null })
        expect(screen.queryByLabelText('Folder')).not.toBeInTheDocument()
    })
})
