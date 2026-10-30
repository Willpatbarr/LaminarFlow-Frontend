import { For } from 'solid-js'

import { setTheme, theme, THEMES, type Theme } from './theme'
import './ThemeSwitch.css'

// 24px stroke paths for the icon button the collapsed rail shows instead.
const ICON: Record<Theme, string> = {
    light: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    dark: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
    system: 'M4 5h16v11H4zM8 20h8M12 16v4',
}

// Light / Dark / System as one segmented radio group, in the account area of the
// rail and the drawer. Arrow keys move between the three, as in any radio group.
//
// The collapsed rail is too narrow for the group, so the stylesheet swaps it for
// one icon button that shows the current choice and steps to the next on each
// press. Both are in the markup; only the one that fits is displayed.
export function ThemeSwitch() {
    const current = () => THEMES.find((t) => t.value === theme())!
    const next = () => THEMES[(THEMES.findIndex((t) => t.value === theme()) + 1) % THEMES.length]
    const words = () => `Theme: ${current().label}. Switch to ${next().label}`
    return (
        <>
            <button
                type="button"
                class="theme-switch__cycle"
                aria-label={words()}
                title={words()}
                onClick={() => setTheme(next().value)}
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                        d={ICON[theme()]}
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                </svg>
            </button>
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
                                const to = THEMES[(at + step + THEMES.length) % THEMES.length]
                                setTheme(to.value)
                                const group = event.currentTarget.parentElement
                                queueMicrotask(() => group?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
                            }}
                        >
                            {item.label}
                        </button>
                    )}
                </For>
            </div>
        </>
    )
}
