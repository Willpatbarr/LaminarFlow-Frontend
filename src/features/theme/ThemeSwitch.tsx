import { For } from 'solid-js'

import { setTheme, theme, THEMES } from './theme'
import './ThemeSwitch.css'

// Light / Dark / System as one segmented radio group, in the account area of the
// rail and the drawer. Arrow keys move between the three, as in any radio group.
export function ThemeSwitch() {
    return (
        <div class="theme-switch" role="radiogroup" aria-label="Theme">
            <For each={THEMES}>
                {(item) => (
                    <button
                        type="button"
                        role="radio"
                        class="theme-switch__option t-meta"
                        aria-checked={theme() === item.value ? 'true' : 'false'}
                        tabindex={theme() === item.value ? 0 : -1}
                        onClick={() => setTheme(item.value)}
                        onKeyDown={(event) => {
                            const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
                            if (step === 0) return
                            event.preventDefault()
                            const at = THEMES.findIndex((t) => t.value === item.value)
                            const next = THEMES[(at + step + THEMES.length) % THEMES.length]
                            setTheme(next.value)
                            const group = event.currentTarget.parentElement
                            queueMicrotask(() => group?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
                        }}
                    >
                        {item.label}
                    </button>
                )}
            </For>
        </div>
    )
}
