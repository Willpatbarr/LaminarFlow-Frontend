import { createSignal, flush } from 'solid-js'

/*
┌─ theme ─────────────────────────────────────────
│  Light / Dark / System switch, stored per device (LAM-144)
├─ out ───────────────────────────────────────────
│      theme()            the saved choice: 'light' | 'dark' | 'system' (default)
│      setTheme(choice)   saves it and applies it
│      applyTheme()       re-applies it; the app calls it once at start
│      THEMES             the three choices, in menu order
├─ example ───────────────────────────────────────
│      setTheme('light')  →  <html data-theme="light">, localStorage lf-theme=light
*/
// `data-theme` on <html> pins light or dark (index.css); with no attribute the
// page follows the OS. index.html carries a tiny copy of readStored/apply that
// runs before first paint, so a reload does not flash the other theme; keep the
// two in step (STORAGE_KEY and the colours below).

export type Theme = 'light' | 'dark' | 'system'
export const THEMES: { value: Theme; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
]

export const STORAGE_KEY = 'lf-theme'
// --bg-base in each theme: what the mobile browser chrome is painted with.
export const THEME_COLOR = { light: '#f7f7f5', dark: '#0d1013' } as const

const isTheme = (value: unknown): value is Theme => value === 'light' || value === 'dark' || value === 'system'

/** The saved choice; System when nothing is saved or storage is unavailable. */
export function readStored(): Theme {
    try {
        const value = localStorage.getItem(STORAGE_KEY)
        return isTheme(value) ? value : 'system'
    } catch {
        return 'system'
    }
}

// `current` is the truth for the page; the signal mirrors it for the UI (Solid
// batches a write, so it is flushed to read back at once).
let current: Theme = readStored()
const [theme, setSignal] = createSignal<Theme>(current)
export { theme }

function remember(choice: Theme) {
    current = choice
    setSignal(choice)
    flush()
}

const query = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null)

/** Light or dark right now: the choice, or the OS's when it is System. */
export function resolved(choice: Theme = current): 'light' | 'dark' {
    if (choice !== 'system') return choice
    return query()?.matches ? 'light' : 'dark'
}

/** Puts the current choice on the page: the attribute, the form-control colour
 *  scheme and the browser chrome colour. */
export function applyTheme(): void {
    const choice = current
    const root = document.documentElement
    if (choice === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', choice)
    document
        .querySelector('meta[name="color-scheme"]')
        ?.setAttribute('content', choice === 'system' ? 'dark light' : choice)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[resolved(choice)])
}

export function setTheme(choice: Theme): void {
    try {
        if (choice === 'system') localStorage.removeItem(STORAGE_KEY)
        else localStorage.setItem(STORAGE_KEY, choice)
    } catch {
        // Private mode or blocked storage: the choice holds until the tab closes.
    }
    remember(choice)
    applyTheme()
}

// System follows the OS while the app is open: the CSS already does, but the
// browser-chrome colour is ours to update.
query()?.addEventListener('change', () => {
    if (current === 'system') applyTheme()
})

// Another tab changed it: follow.
if (typeof addEventListener === 'function') {
    addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY && event.key !== null) return
        remember(readStored())
        applyTheme()
    })
}
