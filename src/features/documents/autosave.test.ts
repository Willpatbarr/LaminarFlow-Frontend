import { createRoot, createSignal, flush as flushSignals } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAutosave } from './autosave'

// LAM-130: a field saves while it is typed into, not only when focus leaves it.

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function setup(options: Parameters<typeof createAutosave>[2] = { delay: 1000 }) {
    const [stored, setStored] = createSignal('')
    const [version, setVersionSignal] = createSignal(4)
    const setVersion = (value: number) => {
        setVersionSignal(value)
        flushSignals()
    }
    const save = vi.fn(async (value: string, _context: { base: number | null }) => {
        setStored(value)
        flushSignals()
    })
    let dispose = () => {}
    const field = createRoot((d) => {
        dispose = d
        return createAutosave(stored, save, { base: version, ...(typeof options === 'object' ? options : {}) })
    })
    const type = (value: string) => {
        field.input(value)
        flushSignals()
    }
    return { field, save, stored, setStored, setVersion, dispose: () => dispose(), type }
}

describe('createAutosave', () => {
    it('saves once, a second after the last keystroke', async () => {
        const { save, type } = setup()
        type('H')
        await vi.advanceTimersByTimeAsync(600)
        type('He')
        await vi.advanceTimersByTimeAsync(600)
        type('Hel')
        expect(save).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1000)
        expect(save).toHaveBeenCalledTimes(1)
        expect(save.mock.calls[0][0]).toBe('Hel')
    })

    it('flush saves at once and cancels the pending timer', async () => {
        const { field, save, type } = setup()
        type('Hi')
        await field.flush()
        expect(save).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(5000)
        expect(save).toHaveBeenCalledTimes(1)
    })

    it('saves what is pending when the page is left (unmount)', async () => {
        const { save, type, dispose } = setup()
        type('Last words')
        dispose()
        await vi.advanceTimersByTimeAsync(0)
        expect(save).toHaveBeenCalledWith('Last words', expect.anything())
    })

    it('saves what is pending on beforeunload', async () => {
        const { save, type } = setup()
        type('Closing')
        window.dispatchEvent(new Event('beforeunload'))
        await vi.advanceTimersByTimeAsync(0)
        expect(save).toHaveBeenCalledWith('Closing', expect.anything())
    })

    it('does not save while canSave says no, and keeps the text', async () => {
        const [ok, setOk] = createSignal(false)
        const { field, save, type } = setup({ delay: 1000, canSave: ok })
        type('')
        await vi.advanceTimersByTimeAsync(3000)
        await field.flush()
        expect(save).not.toHaveBeenCalled()
        expect(field.value()).toBe('')
        setOk(true)
        type('Now fine')
        await vi.advanceTimersByTimeAsync(1000)
        expect(save).toHaveBeenCalledTimes(1)
    })

    it('does not save an unchanged value', async () => {
        const { field, save, setStored, type } = setup()
        setStored('Same')
        flushSignals()
        type('Same')
        await field.flush()
        expect(save).not.toHaveBeenCalled()
    })

    it('hands save the version the edit started from, even if the row moves on while typing', async () => {
        const { save, setVersion, type } = setup()
        type('a')
        setVersion(5) // the row moved on after the edit began
        await vi.advanceTimersByTimeAsync(500)
        type('ab')
        await vi.advanceTimersByTimeAsync(1000)
        expect(save.mock.calls[0][1]).toEqual({ base: 4 })
    })

    it('captures a fresh base when a new edit starts after the draft was saved', async () => {
        const { save, setVersion, type } = setup()
        type('one')
        await vi.advanceTimersByTimeAsync(1000)
        expect(save.mock.calls[0][1]).toEqual({ base: 4 })
        setVersion(6)
        type('one two')
        await vi.advanceTimersByTimeAsync(1000)
        expect(save.mock.calls[1][1]).toEqual({ base: 6 })
    })

    it('shows the draft, not the store, while typing, and does not revert after the save lands', async () => {
        const { field, setStored, type } = setup()
        type('mine')
        setStored('someone else')
        flushSignals()
        expect(field.value()).toBe('mine')
        await vi.advanceTimersByTimeAsync(1000)
        expect(field.value()).toBe('mine')
    })

    it('keeps text typed while a save is in flight', async () => {
        const { field, save, type } = setup()
        type('ab')
        await vi.advanceTimersByTimeAsync(1000)
        expect(save).toHaveBeenCalledTimes(1)
        type('abc')
        expect(field.value()).toBe('abc')
        await vi.advanceTimersByTimeAsync(1000)
        expect(save).toHaveBeenCalledTimes(2)
        expect(field.value()).toBe('abc')
    })
})
