import { render, screen } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'

import { ProgressBar } from './ProgressBar'

describe('ProgressBar', () => {
    it('is a labelled progressbar with its value and maximum', () => {
        render(() => <ProgressBar done={3} total={4} label="Progress of Checkout" />)
        const bar = screen.getByRole('progressbar', { name: 'Progress of Checkout' })
        expect(bar).toHaveAttribute('aria-valuenow', '3')
        expect(bar).toHaveAttribute('aria-valuemax', '4')
        expect(bar).toHaveAttribute('aria-valuetext', '3 of 4 done')
        expect(bar.firstElementChild).toHaveStyle({ width: '75%' })
    })

    it('is empty, not broken, with no tickets', () => {
        render(() => <ProgressBar done={0} total={0} label="Empty" />)
        const bar = screen.getByRole('progressbar', { name: 'Empty' })
        expect(bar).toHaveAttribute('aria-valuenow', '0')
        expect(bar).toHaveAttribute('aria-valuemax', '1')
        expect(bar.firstElementChild).toHaveStyle({ width: '0%' })
    })
})
