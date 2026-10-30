import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { createSignal, flush, Show } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'

import { Banner } from './Banner'
import { Toast } from './Toast'

describe('Banner', () => {
    it('is a polite status region by default, with its message in it from the start', () => {
        render(() => <Banner>Saved on this device.</Banner>)

        expect(screen.getByRole('status')).toHaveTextContent('Saved on this device.')
    })

    it('can be an alert, and runs its action and dismiss', async () => {
        const onAction = vi.fn()
        const onDismiss = vi.fn()
        render(() => (
            <Banner role="alert" action="Sign in" onAction={onAction} onDismiss={onDismiss}>
                Signed out.
            </Banner>
        ))
        const user = userEvent.setup()

        expect(screen.getByRole('alert')).toHaveTextContent('Signed out.')
        await user.click(screen.getByRole('button', { name: 'Sign in' }))
        await user.click(screen.getByRole('button', { name: 'Dismiss' }))

        expect(onAction).toHaveBeenCalledTimes(1)
        expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    it('reports whether its action has opened what is under it, and shows that', () => {
        render(() => (
            <Banner action="Sign in" actionExpanded details={<p>The form</p>}>
                Signed out.
            </Banner>
        ))

        expect(screen.getByRole('button', { name: 'Sign in' })).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByText('The form')).toBeInTheDocument()
    })

    it('does not take focus when it appears', () => {
        const [shown, setShown] = createSignal(false)
        render(() => (
            <>
                <input aria-label="Title" />
                <Show when={shown()}>
                    <Banner action="Retry">Trouble.</Banner>
                </Show>
            </>
        ))
        screen.getByLabelText('Title').focus()

        setShown(true)
        flush()

        expect(screen.getByRole('status')).toBeInTheDocument()
        expect(screen.getByLabelText('Title')).toHaveFocus()
    })

    it('offers no dismiss or action unless asked', () => {
        render(() => <Banner>Plain.</Banner>)

        expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
})

describe('Toast', () => {
    it('is a polite status with a title, a detail and an action', async () => {
        const onAction = vi.fn()
        render(() => (
            <Toast
                title="Can't reach the server"
                detail="Your changes are saved here and will retry."
                action="Retry now"
                onAction={onAction}
            />
        ))

        const toast = screen.getByRole('status')
        expect(toast).toHaveTextContent("Can't reach the server")
        expect(toast).toHaveTextContent('will retry')
        await userEvent.setup().click(screen.getByRole('button', { name: 'Retry now' }))
        expect(onAction).toHaveBeenCalledTimes(1)
    })

    it('is dismissed by its own button only, and never moves focus', async () => {
        const onDismiss = vi.fn()
        const [shown, setShown] = createSignal(false)
        render(() => (
            <>
                <input aria-label="Title" />
                <Show when={shown()}>
                    <Toast title="Heads up" detail="Detail." onDismiss={onDismiss} />
                </Show>
            </>
        ))
        screen.getByLabelText('Title').focus()

        setShown(true)
        flush()

        expect(screen.getByRole('status')).toBeInTheDocument()
        expect(screen.getByLabelText('Title')).toHaveFocus()
        expect(onDismiss).not.toHaveBeenCalled()
        await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }))
        expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    it('can be an alert for something that is really lost', () => {
        render(() => <Toast role="alert" hue="rust" title="Lost" detail="It did not save." />)

        expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    it('defaults to rust, and an amber warning has to say so', () => {
        render(() => (
            <>
                <Toast title="Default" />
                <Toast hue="amber" title="Warning" />
            </>
        ))

        const [def, warn] = screen.getAllByRole('status')
        expect(def).toHaveAttribute('data-hue', 'rust')
        expect(warn).toHaveAttribute('data-hue', 'amber')
    })

    it('draws a good outcome\'s mark as the check Icon, hidden from assistive tech', () => {
        const { container } = render(() => <Toast hue="green" mark="check" title="Done" />)

        const mark = container.querySelector('.toast__mark')!
        expect(mark).toHaveAttribute('aria-hidden', 'true')
        expect(mark.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
        expect(mark).not.toHaveTextContent('✓')
    })
})
