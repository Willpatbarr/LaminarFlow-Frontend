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
        expect(screen.getByText(words, { selector: '.connection__label' })).toBeInTheDocument()
    })

    it('says Connected and Signed out, and names the state as its tooltip', () => {
        const { unmount } = render(() => <ConnectionIndicator state="live" />)
        expect(screen.getByRole('status')).toHaveTextContent('Connected')
        expect(screen.getByText('Connected', { selector: '.connection__label' })).toBeInTheDocument()
        expect(document.querySelector('.connection')).toHaveAttribute('title', 'Connected')
        unmount()

        render(() => <ConnectionIndicator state="signed_out" />)
        expect(screen.getByRole('status')).toHaveTextContent('Signed out')
        expect(document.querySelector('.connection')).toHaveAttribute('title', 'Signed out')
    })

    it('draws "Syncing N changes" while live, without putting the count in the live region', () => {
        render(() => <ConnectionIndicator state="live" syncing={1} />)
        expect(document.querySelector('.connection__label')).toHaveTextContent('Syncing 1 change')
        expect(document.querySelector('.connection')).toHaveAttribute('title', 'Syncing 1 change')
        expect(screen.getByRole('status')).toHaveTextContent(/^Connected$/)
    })

    it('does not say syncing when it is not connected', () => {
        render(() => <ConnectionIndicator state="offline" syncing={3} />)
        expect(document.querySelector('.connection__label')).toHaveTextContent(/^Offline$/)
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
