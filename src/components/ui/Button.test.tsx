import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Button } from './Button'

describe('Button', () => {
    it('calls onClick when clicked', async () => {
        const onClick = vi.fn()
        render(<Button onClick={onClick}>Save</Button>)

        await userEvent.click(screen.getByRole('button', { name: 'Save' }))

        expect(onClick).toHaveBeenCalledOnce()
    })
})