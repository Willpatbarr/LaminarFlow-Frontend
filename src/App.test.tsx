import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from './App'

describe('App', () => {
    it('renders the page heading', () => {
        render(<App />)

        expect(
            screen.getByRole('heading', { level: 1, name: 'Get started' }),
        ).toBeInTheDocument()
    })

    it('counts up when the counter is clicked', async () => {
        render(<App />)

        await userEvent.click(screen.getByRole('button', { name: /count is 0/i }))

        expect(
            screen.getByRole('button', { name: /count is 1/i }),
        ).toBeInTheDocument()
    })
})