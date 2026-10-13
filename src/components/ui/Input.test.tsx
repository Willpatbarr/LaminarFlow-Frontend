import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'

import { Input } from './Input'

describe('Input', () => {
    it('is named by its visible label', () => {
        render(() => <Input label="Email" value="" onInput={vi.fn()} />)

        expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument()
    })

    it('hands the typed string, not the event, to onInput', async () => {
        const seen: string[] = []
        render(() => {
            const [value, setValue] = createSignal('')
            return (
                <Input
                    label="Name"
                    value={value()}
                    onInput={(next) => {
                        seen.push(next)
                        setValue(next)
                    }}
                />
            )
        })

        await userEvent.type(screen.getByLabelText('Name'), 'Ada')

        expect(seen).toEqual(['A', 'Ad', 'Ada'])
        expect(screen.getByLabelText('Name')).toHaveValue('Ada')
    })

    it('an error marks the control invalid and describes it', () => {
        render(() => <Input label="Email" value="" onInput={vi.fn()} error="Enter your email." />)

        const input = screen.getByLabelText('Email')
        expect(input).toHaveAttribute('aria-invalid', 'true')
        expect(input).toHaveAccessibleDescription('Enter your email.')
    })

    it('without an error it carries neither attribute', () => {
        render(() => <Input label="Email" value="" onInput={vi.fn()} />)

        const input = screen.getByLabelText('Email')
        expect(input).not.toHaveAttribute('aria-invalid')
        expect(input).not.toHaveAttribute('aria-describedby')
    })

    it('two inputs get different ids, so each label finds its own control', () => {
        render(() => (
            <>
                <Input label="One" value="" onInput={vi.fn()} />
                <Input label="Two" value="" onInput={vi.fn()} />
            </>
        ))

        expect(screen.getByLabelText('One')).not.toBe(screen.getByLabelText('Two'))
    })

    it('exposes the element through ref', () => {
        let el: HTMLInputElement | undefined
        render(() => <Input label="Email" value="" onInput={vi.fn()} ref={(node) => (el = node)} />)

        expect(el).toBe(screen.getByLabelText('Email'))
    })

    describe('with a count', () => {
        const typed = (n: number) => 'x'.repeat(n)

        it('stays quiet until within a tenth of the limit', () => {
            render(() => <Input label="Title" value={typed(89)} onInput={vi.fn()} count={{ used: 89, max: 100 }} />)

            expect(screen.queryByText(/ \/ /)).not.toBeInTheDocument()
            expect(screen.getByLabelText('Title')).not.toHaveAttribute('aria-describedby')
        })

        it('shows used / max from 90% of the limit and describes the control with it', () => {
            render(() => <Input label="Title" value={typed(90)} onInput={vi.fn()} count={{ used: 90, max: 100 }} />)

            expect(screen.getByText('90 / 100')).toBeInTheDocument()
            expect(screen.getByLabelText('Title')).toHaveAccessibleDescription('90 / 100')
            expect(screen.getByLabelText('Title')).not.toHaveAttribute('aria-invalid')
        })

        it('is exactly at the limit and still fine, and over it is invalid even without a message', () => {
            const { unmount } = render(() => (
                <Input label="Title" value={typed(100)} onInput={vi.fn()} count={{ used: 100, max: 100 }} />
            ))
            expect(screen.getByLabelText('Title')).not.toHaveAttribute('aria-invalid')
            unmount()

            render(() => <Input label="Title" value={typed(101)} onInput={vi.fn()} count={{ used: 101, max: 100 }} />)
            expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true')
            expect(screen.getByText('101 / 100')).toHaveClass('input__count--over')
        })

        it('lists the message before the count in the description, and does not cut the text off', () => {
            render(() => (
                <Input
                    label="Title"
                    value={typed(120)}
                    onInput={vi.fn()}
                    count={{ used: 120, max: 100 }}
                    error="Too long."
                />
            ))

            expect(screen.getByLabelText('Title')).toHaveAccessibleDescription('Too long. 120 / 100')
            expect(screen.getByLabelText('Title')).not.toHaveAttribute('maxlength')
            expect(screen.getByLabelText('Title')).toHaveValue(typed(120))
        })
    })
})
