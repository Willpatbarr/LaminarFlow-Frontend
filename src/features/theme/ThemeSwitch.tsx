import { For } from 'solid-js'

import { setTheme, theme, THEMES, type Theme } from './theme'
import { Icon, type IconName } from '@/components/ui/icons/Icon'
import './ThemeSwitch.css'

// The icon button the collapsed rail shows instead.
const ICON: Record<Theme, IconName> = { light: 'sun', dark: 'moon', system: 'monitor' }

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
                <Icon name={ICON[theme()]} />
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
