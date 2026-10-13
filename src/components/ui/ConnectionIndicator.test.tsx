import { render, screen } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'

import { ConnectionIndicator, type ConnectionIndicatorState } from './ConnectionIndicator'

describe('ConnectionIndicator', () => {
    it.each<[ConnectionIndicatorState, string]>([
        ['connecting', 'Connecting'],
        ['reconnecting', 'Reconnecting'],
        ['offline', 'Offline'],
    ])('says %s in words you can see', (state, words) => {
        render(() => <ConnectionIndicator state={state} />)

        expect(screen.getByRole('status')).toHaveTextContent(words)
        expect(screen.getByText(words)).not.toHaveClass('connection__label--quiet')
    })

    it('is quiet when live: the words are for a screen reader only', () => {
        render(() => <ConnectionIndicator state="live" />)

        expect(screen.getByRole('status')).toHaveTextContent('Live')
        expect(screen.getByText('Live')).toHaveClass('connection__label--quiet')
    })

    it('is a polite live region, present before it changes', () => {
        render(() => <ConnectionIndicator state="live" />)

        expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    })

    it('updates in place when the state does', () => {
        let set!: (state: ConnectionIndicatorState) => void
        render(() => {
            const [state, setState] = createSignal<ConnectionIndicatorState>('live')
            set = setState
            return <ConnectionIndicator state={state()} />
        })
        const region = screen.getByRole('status')

        set('reconnecting')

        return vi.waitFor(() => {
            expect(screen.getByRole('status')).toBe(region)
            expect(region).toHaveTextContent('Reconnecting')
        })
    })
})
