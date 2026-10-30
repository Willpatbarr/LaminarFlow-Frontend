import { createSignal } from 'solid-js'

// Whether the search palette is open: the one place that is decided. Cmd/Ctrl+K,
// the side nav's Search button and the mobile top bar's all go through here
// (LAM-183), so none has its own idea of it.
const [open, setOpen] = createSignal(false)
// What had focus when the palette opened; focus goes back to it on close.
let opener: HTMLElement | null = null

export const paletteOpen = open

/** Open the palette. Pass the button that asked (Safari does not focus a
 *  button on tap, so `document.activeElement` cannot be trusted to be it). */
export function openPalette(from?: HTMLElement | null): void {
    opener = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setOpen(true)
}

export function closePalette(): void {
    setOpen(false)
}

export function togglePalette(): void {
    if (open()) closePalette()
    else openPalette()
}

/** Where focus goes when the palette closes. A button inside the shut drawer
 *  is inert, so the menu button that opened the drawer stands in for it. */
export function paletteOpener(): HTMLElement | null {
    if (opener?.isConnected && !opener.closest('[inert]')) return opener
    return document.querySelector<HTMLElement>('.app-shell__menu')
}
