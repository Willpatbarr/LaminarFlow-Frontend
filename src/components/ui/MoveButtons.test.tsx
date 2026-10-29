import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MoveButtons } from './MoveButtons'

describe('MoveButtons', () => {
    it('names the pair "Move <name> up/down" and moves by one', async () => {
        const onMove = vi.fn()
        render(() => <MoveButtons name="Owner" first={false} last={false} onMove={onMove} />)

        await userEvent.click(screen.getByRole('button', { name: 'Move Owner up' }))
        await userEvent.click(screen.getByRole('button', { name: 'Move Owner down' }))

        expect(onMove.mock.calls).toEqual([[-1], [1]])
    })

    it('keeps the end button visible but disabled, and says why', () => {
        render(() => <MoveButtons name="Owner" first last={false} onMove={() => {}} />)

        const up = screen.getByRole('button', { name: 'Move Owner up' })
        expect(up).toBeDisabled()
        expect(up).toHaveAccessibleDescription('Already first')
        expect(screen.getByRole('button', { name: 'Move Owner down' })).toBeEnabled()
    })

    it('says "Already last" on the last row, and a permission reason wins', () => {
        const { unmount } = render(() => <MoveButtons name="Owner" first={false} last onMove={() => {}} />)
        expect(screen.getByRole('button', { name: 'Move Owner down' })).toHaveAccessibleDescription('Already last')
        unmount()

        render(() => <MoveButtons name="Owner" first last disabledReason="You cannot change fields" onMove={() => {}} />)
        expect(screen.getByRole('button', { name: 'Move Owner up' })).toHaveAccessibleDescription('You cannot change fields')
    })
})
