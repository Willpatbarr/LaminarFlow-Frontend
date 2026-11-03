import '@/components/ui/RowMenu.css'
import './settings.css'
import { Icon } from '@/components/ui/icons/Icon'
import { ShortcutHint } from '@/features/shortcuts'
import { setTheme, theme, THEMES } from '@/features/theme'

// The items of the account menu the sidebar's profile block opens (LAM-200):
// Settings (with its key beside it), API tokens, the theme, and Log out.
// Links are real anchors, so they open in a new tab and the router handles a
// plain click; the Popover (role "menu") gives them arrow keys, Esc and focus
// return, and closes on activating one.
export function AccountMenuItems(props: { onLogout: () => void }) {
    return (
        <>
            <a role="menuitem" class="row-menu__item" href="/settings">
                <Icon name="settings" />
                Settings
                <ShortcutHint id="nav.settings" />
            </a>
            <a role="menuitem" class="row-menu__item" href="/settings/tokens">
                <Icon name="key" />
                API tokens
            </a>
            <hr class="row-menu__rule" aria-hidden="true" />
            <p class="row-menu__head t-meta" aria-hidden="true">
                Theme
            </p>
            {THEMES.map((option) => (
                <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={theme() === option.value ? 'true' : 'false'}
                    class="row-menu__item"
                    onClick={() => setTheme(option.value)}
                >
                    {option.label}
                    {theme() === option.value ? <Icon class="row-menu__check" name="check" /> : null}
                </button>
            ))}
            <hr class="row-menu__rule" aria-hidden="true" />
            <button type="button" role="menuitem" class="row-menu__item" onClick={props.onLogout}>
                <Icon name="logout" />
                Log out
            </button>
        </>
    )
}
