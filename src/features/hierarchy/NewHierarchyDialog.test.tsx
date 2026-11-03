import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NewHierarchyDialog } from './NewHierarchyDialog'

const sync = vi.hoisted(() => ({
    createEpic: vi.fn(),
    createSprint: vi.fn(),
    createMilestone: vi.fn(),
    sprintsForProject: vi.fn(() => []),
    sync: { projects: [{ id: 'p-1', team_id: 'team-1', name: 'P' }] },
}))
const length = vi.hoisted(() => ({ sprintLengthDays: vi.fn(async () => 14) }))
vi.mock('./sprintLength', () => length)
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

describe('NewHierarchyDialog sprint dates (LAM-222)', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 3, 12) })
    })
    afterEach(() => {
        vi.useRealTimers()
    })
    const open = async () => {
        render(() => <NewHierarchyDialog kind="sprint" projectId="p-1" onClose={() => {}} />)
        const dialog = await screen.findByRole('dialog')
        return {
            dialog,
            start: within(dialog).getByLabelText('Start date') as HTMLInputElement,
            end: within(dialog).getByLabelText('End date') as HTMLInputElement,
        }
    }

    it('starts today and ends 14 days later, written as 3 Nov 2026', async () => {
        const { dialog, start, end } = await open()
        expect(start.value).toBe('2026-11-03')
        await vi.waitFor(() => expect(end.value).toBe('2026-11-17'))
        expect(within(dialog).getByText('3 Nov 2026')).toBeInTheDocument()
        expect(within(dialog).getByText('17 Nov 2026')).toBeInTheDocument()
    })

    it('uses the team sprint.length_days', async () => {
        length.sprintLengthDays.mockResolvedValueOnce(7)
        const { end } = await open()
        await vi.waitFor(() => expect(end.value).toBe('2026-11-10'))
    })

    it('starts the day after the latest sprint ends, when that is later than today', async () => {
        sync.sprintsForProject.mockReturnValueOnce([{ end_date: '2026-11-10' }, { end_date: '2026-11-20' }, { end_date: null }] as never)
        const { start, end } = await open()
        expect(start.value).toBe('2026-11-21')
        await vi.waitFor(() => expect(end.value).toBe('2026-12-05'))
    })

    it('starts today when every sprint has already ended', async () => {
        sync.sprintsForProject.mockReturnValueOnce([{ end_date: '2026-10-01' }] as never)
        const { start } = await open()
        expect(start.value).toBe('2026-11-03')
    })

    it('moves the end with the start until the end is set by hand', async () => {
        const { start, end } = await open()
        fireEvent.input(start, { target: { value: '2026-12-01' } })
        await vi.waitFor(() => expect(end.value).toBe('2026-12-15'))
        fireEvent.input(end, { target: { value: '2026-12-10' } })
        fireEvent.input(start, { target: { value: '2026-12-05' } })
        await vi.waitFor(() => expect(start.value).toBe('2026-12-05'))
        expect(end.value).toBe('2026-12-10')
    })
})

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
