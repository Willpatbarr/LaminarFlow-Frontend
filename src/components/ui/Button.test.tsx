import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Button } from './Button'

describe('Button', () => {
    it('calls onClick when clicked', async () => {
        const onClick = vi.fn()
        render(() => <Button onClick={onClick}>Save</Button>)

        await userEvent.click(screen.getByRole('button', { name: 'Save' }))

        expect(onClick).toHaveBeenCalledOnce()
    })

    it('is type=button unless told otherwise, so it never submits a form by accident', () => {
        render(() => <Button>Save</Button>)

        expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button')
    })

    it('type=submit submits its form', async () => {
        const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault())
        render(() => (
            <form onSubmit={onSubmit}>
                <Button type="submit">Go</Button>
            </form>
        ))

        await userEvent.click(screen.getByRole('button', { name: 'Go' }))

        expect(onSubmit).toHaveBeenCalledOnce()
    })

    it('disabled does not fire onClick', async () => {
        const onClick = vi.fn()
        render(() => (
            <Button disabled onClick={onClick}>
                Save
            </Button>
        ))

        await userEvent.click(screen.getByRole('button', { name: 'Save' }))

        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
        expect(onClick).not.toHaveBeenCalled()
    })
})
