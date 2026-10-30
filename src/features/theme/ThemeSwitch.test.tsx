import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { setTheme, theme } from './theme'
import { ThemeSwitch } from './ThemeSwitch'

describe('ThemeSwitch', () => {
    beforeEach(() => setTheme('system'))

    it('has the radio group and an icon button that cycles Light, Dark, System and says where it is', async () => {
        render(() => <ThemeSwitch />)
        const user = userEvent.setup()

        expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument()
        const cycle = screen.getByRole('button', { name: 'Theme: System. Switch to Light' })
        expect(cycle).toHaveAttribute('title', 'Theme: System. Switch to Light')

        await user.click(cycle)
        expect(theme()).toBe('light')
        await user.click(screen.getByRole('button', { name: 'Theme: Light. Switch to Dark' }))
        expect(theme()).toBe('dark')
        await user.click(screen.getByRole('button', { name: 'Theme: Dark. Switch to System' }))
        expect(theme()).toBe('system')
    })
})
