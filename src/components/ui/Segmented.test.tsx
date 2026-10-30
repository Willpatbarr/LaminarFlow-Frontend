import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { createSignal } from 'solid-js'
import { describe, expect, it } from 'vitest'

import { Segmented, SegmentedNav } from './Segmented'

describe('Segmented', () => {
    it('is a radio group where the arrow keys move the choice', async () => {
        const [value, setValue] = createSignal<'a' | 'b'>('a')
        render(() => (
            <Segmented
                label="Pick"
                value={value()}
                onChange={setValue}
                items={[
                    { value: 'a', label: 'Alpha' },
                    { value: 'b', label: 'Beta' },
                ]}
            />
        ))
        const user = userEvent.setup()
        screen.getByRole('radio', { name: 'Alpha' }).focus()
        await user.keyboard('{ArrowRight}')
        expect(value()).toBe('b')
        expect(screen.getByRole('radio', { name: 'Beta' })).toHaveAttribute('aria-checked', 'true')
    })
})

describe('SegmentedNav', () => {
    it('is links, with aria-current on the current page only', () => {
        render(() => (
            <SegmentedNav
                label="View"
                current="list"
                items={[
                    { value: 'list', label: 'List', href: '/l' },
                    { value: 'board', label: 'Board', href: '/b' },
                ]}
            />
        ))
        expect(screen.getByRole('navigation', { name: 'View' })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'List' })).toHaveAttribute('aria-current', 'page')
        expect(screen.getByRole('link', { name: 'Board' })).not.toHaveAttribute('aria-current')
        expect(screen.getByRole('link', { name: 'Board' })).toHaveAttribute('href', '/b')
    })
})
