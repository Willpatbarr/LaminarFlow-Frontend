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
})
