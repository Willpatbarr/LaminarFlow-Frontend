import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Checkbox } from './Checkbox'

describe('Checkbox', () => {
    it('is a real checkbox named by its wrapping label', () => {
        render(() => (
            <label>
                <Checkbox checked={false} />
                Create more
            </label>
        ))
        expect(screen.getByRole('checkbox', { name: 'Create more' })).not.toBeChecked()
    })

    it('toggles with Space and with a click on the label', async () => {
        const user = userEvent.setup()
        const onChange = vi.fn()
        render(() => (
            <label>
                <Checkbox onChange={(event) => onChange(event.currentTarget.checked)} />
                Epic
            </label>
        ))
        const box = screen.getByRole('checkbox', { name: 'Epic' })
        box.focus()
        await user.keyboard(' ')
        expect(box).toBeChecked()
        await user.click(screen.getByText('Epic'))
        expect(box).not.toBeChecked()
        expect(onChange.mock.calls).toEqual([[true], [false]])
    })

    it('keeps disabled and aria-label on the input', () => {
        render(() => <Checkbox disabled aria-label="Title" checked />)
        expect(screen.getByRole('checkbox', { name: 'Title' })).toBeDisabled()
    })
})
