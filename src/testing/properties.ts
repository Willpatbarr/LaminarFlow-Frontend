import { screen, within } from '@solidjs/testing-library'
import type { UserEvent } from '@testing-library/user-event'
import { expect } from 'vitest'

// The ticket page's property buttons (LAM-211). Each is one button named
// "Status: In Progress"; pressing it opens a list of options.

/** The button for a property ("Status", "Epic" ...). */
export function property(name: string) {
    return screen.findByRole('button', { name: new RegExp(`^${name}:`) })
}

/** Checks what a property reads. */
export async function expectProperty(name: string, value: string) {
    expect(await property(name)).toHaveAccessibleName(`${name}: ${value}`)
}

/** Opens a property's list and returns it. */
export async function openProperty(user: UserEvent, name: string) {
    await user.click(await property(name))
    return screen.findByRole('listbox', { name })
}

/** Opens a property's list and chooses an option by its name. */
export async function pickProperty(user: UserEvent, name: string, option: string) {
    const list = await openProperty(user, name)
    await user.click(within(list).getByRole('option', { name: option }))
}
