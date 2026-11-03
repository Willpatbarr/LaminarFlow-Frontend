import { cleanup, render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NewHierarchyDialog } from './NewHierarchyDialog'

const sync = vi.hoisted(() => ({
    createEpic: vi.fn(),
    createSprint: vi.fn(),
    createMilestone: vi.fn(),
}))
vi.mock('@/sync', () => sync)

afterEach(() => {
    cleanup()
    vi.clearAllMocks()
})

// LAM-231: a caller (the ticket page) assigns what the dialog made, so the dialog
// must hand the row on after a create, and hand nothing on otherwise.
async function fill(user: ReturnType<typeof userEvent.setup>, kind: 'epic' | 'sprint' | 'milestone') {
    const onCreated = vi.fn()
    const onClose = vi.fn()
    render(() => <NewHierarchyDialog kind={kind} projectId="p-1" onCreated={onCreated} onClose={onClose} />)
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Name'), 'Thing')
    return { dialog, onCreated, onClose }
}

describe('NewHierarchyDialog', () => {
    it.each([
        ['epic', 'createEpic'],
        ['sprint', 'createSprint'],
        ['milestone', 'createMilestone'],
    ] as const)('hands the new %s to onCreated, then closes', async (kind, fn) => {
        sync[fn].mockResolvedValue({ id: 'new-1', name: 'Thing' })
        const user = userEvent.setup()
        const { dialog, onCreated, onClose } = await fill(user, kind)
        await user.click(within(dialog).getByRole('button', { name: `Create ${kind}` }))
        await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
        expect(onCreated).toHaveBeenCalledWith({ id: 'new-1', name: 'Thing' })
    })

    it('hands nothing on when cancelled', async () => {
        const user = userEvent.setup()
        const { dialog, onCreated, onClose } = await fill(user, 'sprint')
        await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
        expect(onClose).toHaveBeenCalledOnce()
        expect(onCreated).not.toHaveBeenCalled()
        expect(sync.createSprint).not.toHaveBeenCalled()
    })

    it('hands nothing on when the create fails, and stays open to try again', async () => {
        sync.createEpic.mockRejectedValueOnce(new Error('disk full'))
        const user = userEvent.setup()
        const { dialog, onCreated, onClose } = await fill(user, 'epic')
        await user.click(within(dialog).getByRole('button', { name: 'Create epic' }))
        await vi.waitFor(() => expect(sync.createEpic).toHaveBeenCalledOnce())
        expect(onCreated).not.toHaveBeenCalled()
        expect(onClose).not.toHaveBeenCalled()
        await vi.waitFor(() => expect(within(dialog).getByRole('button', { name: 'Create epic' })).toBeEnabled())

        sync.createEpic.mockResolvedValueOnce({ id: 'e-2', name: 'Thing' })
        await user.click(within(dialog).getByRole('button', { name: 'Create epic' }))
        await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'e-2', name: 'Thing' }))
    })
})
