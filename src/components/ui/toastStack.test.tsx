import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { createSignal, flush, For } from 'solid-js'
import { afterEach, describe, expect, it } from 'vitest'

import { Toast } from './Toast'
import { ToastOverflow } from './ToastOverflow'
import { resetToastStack } from './toastStack'

afterEach(resetToastStack)

function setup(titles: string[]) {
    const [list, setList] = createSignal(titles)
    render(() => (
        <>
            <For each={list()}>{(t) => <Toast title={t} onDismiss={() => setList((l) => l.filter((x) => x !== t))} />}</For>
            <ToastOverflow />
        </>
    ))
    return setList
}

const shown = () => screen.queryAllByRole('status').map((e) => e.textContent)

describe('toast stack', () => {
    it('shows two toasts in full with no overflow control', () => {
        setup(['One', 'Two'])
        expect(shown()).toHaveLength(2)
        expect(screen.queryByRole('button', { name: /more/ })).not.toBeInTheDocument()
    })

    it('folds older toasts into "+N more" and expands them again, dropping nothing', async () => {
        setup(['One', 'Two', 'Three', 'Four'])
        const user = userEvent.setup()

        expect(shown()).toHaveLength(2)
        expect(shown().join()).toMatch(/Three.*Four/)
        await user.click(screen.getByRole('button', { name: '+2 more' }))
        expect(shown()).toHaveLength(4)

        await user.click(screen.getByRole('button', { name: 'Show fewer' }))
        expect(shown()).toHaveLength(2)
    })

    it('keeps a Dismiss on every visible toast and unfolds one when a newer one is dismissed', async () => {
        setup(['One', 'Two', 'Three'])
        const user = userEvent.setup()

        expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(2)
        await user.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]!)
        flush()
        expect(shown()).toHaveLength(2)
        expect(screen.queryByRole('button', { name: /more/ })).not.toBeInTheDocument()
    })
})
