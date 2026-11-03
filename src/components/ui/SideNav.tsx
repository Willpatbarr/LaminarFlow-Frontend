import type { JSX } from '@solidjs/web'
import { createEffect, createSignal, For, Show, untrack } from 'solid-js'

import { Avatar } from './Avatar'
import { Icon, ICON_PATHS, type IconName } from './icons/Icon'
import { Popover } from './Popover'
import { Select, type SelectOption } from './Select'
import { SkeletonCircle, SkeletonLine } from './Skeleton'
import { Tooltip } from './Tooltip'
import { NARROW_QUERY, TABLET_QUERY, useMediaQuery } from './useNarrowScreen'
import './SideNav.css'

// A create action wears the icon of the thing it makes, shrunk, with a plus in
// the corner: "New epic" is not mistaken for "New sprint" when only icons show.
const PLUS_BADGE = 'M19 16v6M16 19h6'

// The user's own choice to collapse or expand the rail, kept across visits. It
// is only written when they press the button, so "nothing stored" still means
// "no preference" and the default (a rail on a tablet) can apply.
const COLLAPSED_KEY = 'lf-side-nav-collapsed'

// A click on one of these inside the tablet overlay is "going somewhere".
const GOES_SOMEWHERE = 'a[href], .side-nav__create, .side-nav__search, .side-nav__help, .side-nav__logout'

function storedCollapsed(): boolean | undefined {
    try {
        const value = localStorage.getItem(COLLAPSED_KEY)
        return value === '1' ? true : value === '0' ? false : undefined
    } catch {
        return undefined
    }
}

function storeCollapsed(collapsed: boolean) {
    try {
        localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
    } catch {
        // Private mode or a full store: the choice lasts until the page closes.
    }
}

export type SideNavLink = {
    label: string
    href: string
    /** A coolicons name (see icons/paths.ts). Home when absent. */
    icon?: IconName
    /** A word after the label, such as "Private". Quiet, and read out with it. */
    note?: string
    /** A saved view's reach (LAM-227): "private" shows a lock; either one is
     *  part of the accessible name and the rail tooltip ("Mine, private view"). */
    scope?: 'private' | 'team'
    /** Two letters that stand in for the icon while the rail is collapsed, for
     *  rows whose icon is the same on every row (projects, saved views). */
    initials?: string
    /** The keys that go here, as text beside the label ("G then T"). Hidden
     *  from screen readers, who get it as `aria-keyshortcuts` instead. */
    hint?: string
}

/** The team switcher: the teams the account has and the one in view. */
export type SideNavTeams = {
    options: SelectOption[]
    value: string
    onChange: (teamId: string) => void
}

type SideNavProps = {
    links: SideNavLink[]
    /** Absent until the account has a team. */
    teams?: SideNavTeams
    /** The active team's projects, one link each. */
    projects?: SideNavLink[]
    /** The active team's saved views, one link each (LAM-118). Absent until the
     *  account has a team; an empty list says so. */
    views?: SideNavLink[]
    /** Things that can be made from anywhere, one button each (LAM-105). Absent
     *  until there is a project to make them in. */
    create?: {
        label: string
        onClick: () => void
        /** The icon of the thing made. */
        icon?: IconName
        /** Why it cannot be used right now (LAM-199). The button stays, disabled, and says so
         *  in a tooltip and in a line under the list - disabled is not hidden. */
        disabledReason?: string
    }[]
    /** The signed-in user. Absent while it is not known yet, which draws an
     *  empty profile slot rather than a different layout. */
    userName?: string
    /** Account settings that live in the rail, such as the theme switch (LAM-144).
     *  Shown in the drawer too; sits above the status. The caller's to fill. */
    account?: JSX.Element
    /** Sits at the foot of the rail, above the log-out button: a quiet status
     *  such as the connection indicator. Optional, and the caller's to fill. */
    status?: JSX.Element
    /** The Search button at the top of the rail (LAM-183). Absent: none. `hint` is
     *  the shortcut written beside it. */
    search?: { onClick: (button: HTMLButtonElement) => void; hint?: string }
    /** The Settings button in the foot, above Log out (LAM-200); `hint` is the key written
     *  beside it. The router marks it `aria-current` on /settings and `data-active` under it
     *  (/settings/tokens), which the stylesheet reads. Absent: none. */
    settings?: { href: string; hint?: string }
    /** The items of the menu the profile block opens (LAM-200): `role="menuitem"` elements. Absent:
     *  the profile is a plain label, not a button. */
    menu?: JSX.Element
    /** The "Keyboard shortcuts" button in the foot, above Settings (LAM-223); `hint` is the
     *  key written beside it. Hidden on touch-only devices, like the hints. Absent: none. */
    help?: { onClick: () => void; hint?: string }
    onLogout: () => void
    /** Changes whenever the user has gone somewhere (the path). On a tablet an expanded
     *  sidebar floats over the page, and it shuts when this changes (LAM-218). */
    route?: string
    /** Draw the rail's own placeholder: the profile slot and one bar per link,
     *  with nothing to click. For the moment before the session is known. */
    loading?: boolean
}

/** Up to two letters for the profile monogram: first and last word's initial. */
export function monogram(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return ''
    const first = words[0]
    const last = words.length > 1 ? words[words.length - 1] : ''
    return (Array.from(first)[0] + (Array.from(last)[0] ?? '')).toUpperCase()
}

/** Up to two letters for a row's stand-in icon: the first letters of the first
 *  two words, or the first two letters of a single word. */
export function initialsOf(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return ''
    const letters = words.length > 1 ? [Array.from(words[0])[0], Array.from(words[1])[0]] : Array.from(words[0]).slice(0, 2)
    return letters.join('').toUpperCase()
}

// The rail from the Side Nav specimen, reduced to what exists: the profile slot
// from TopNavBar, then the nav links. The specimen's search, new-doc and
// new-ticket slots, back/forward buttons and Teams/Projects sections are left
// out on purpose - each would be a control that does nothing today.
//
// Links are plain anchors; the router adds `aria-current="page"` to the one
// matching the URL, and the stylesheet keys the active look off that.
//
// Loading draws the same rail: the monogram's circle, a bar for the name, a
// 32px row for each link the caller listed (so the placeholder is as tall as the
// real rail will be), and a row where Log out goes. `status` and `onLogout` are
// not shown - a connection indicator or a way out of a session nobody has
// confirmed yet would be a lie.
export function SideNav(props: SideNavProps) {
    // Collapsing narrows the rail to icons. Nothing is removed from it: every
    // label stays in the accessibility tree and as a tooltip, and the team
    // switcher stays a working control.
    //
    // On a tablet (768-1024px) the full sidebar would leave the content too
    // little room, so with no stored choice it starts as the rail; expanded, it
    // floats over the content instead of pushing it (AppShell.css). A choice the
    // user has made always wins, at any width. In the phone drawer it never
    // collapses: the drawer is already the compact form.
    const [chosen, setChosen] = createSignal<boolean | undefined>(storedCollapsed())
    const tablet = useMediaQuery(TABLET_QUERY)
    const phone = useMediaQuery(NARROW_QUERY)
    // On a tablet an expanded sidebar is an overlay (LAM-218). Shutting it by
    // navigating, clicking away or pressing Escape is not a new preference, so
    // it is not stored: it only holds the rail until the user expands it again.
    const [dismissed, setDismissed] = createSignal(false)
    const collapsed = () => !phone() && (tablet() && dismissed() ? true : (chosen() ?? tablet()))
    const overlayOpen = () => tablet() && !phone() && !collapsed()
    const toggle = () => {
        const next = !collapsed()
        setChosen(next)
        storeCollapsed(next)
        setDismissed(false)
    }
    let aside: HTMLElement | undefined
    let toggleButton: HTMLButtonElement | undefined
    const dismiss = () => setDismissed(true)

    // Going anywhere (a shortcut, the back button, a link) shuts the overlay.
    // Focus stays where it is: the control it was on is still in the rail.
    let lastRoute = untrack(() => props.route)
    createEffect(
        () => props.route,
        (route) => {
            const moved = route !== lastRoute
            lastRoute = route
            if (moved && untrack(overlayOpen)) dismiss()
        },
    )

    // While the overlay is open, a press outside it or Escape shuts it. Escape
    // puts focus on the toggle button when it was inside the sidebar, so a
    // keyboard user lands on the button that reopens it.
    createEffect(overlayOpen, (isOpen) => {
        if (!isOpen) return
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Element | null
            if (!target || aside?.contains(target)) return
            // A menu the sidebar opened is portaled out of it, but it is part of it.
            if (target.closest('.popover-host, .popover')) return
            dismiss()
        }
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return
            const inside = aside?.contains(document.activeElement)
            dismiss()
            if (inside) toggleButton?.focus()
        }
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('pointerdown', onPointerDown)
            document.removeEventListener('keydown', onKey)
        }
    })

    // The rail's tooltips (LAM-218): hover or focus on anything marked
    // `data-tip` shows its text beside it, fixed to the viewport so the
    // rail's own scrolling does not clip it. Escape hides it again.
    const [tip, setTip] = createSignal<{ text: string; top: number; left: number } | undefined>()
    const showTip = (event: Event) => {
        if (!collapsed()) return setTip(undefined)
        const holder = (event.target as Element | null)?.closest<HTMLElement>('[data-tip]')
        if (!holder?.dataset.tip) return setTip(undefined)
        const box = holder.getBoundingClientRect()
        setTip({ text: holder.dataset.tip, top: box.top + box.height / 2, left: box.right + 8 })
    }
    const hideTip = () => setTip(undefined)
    createEffect(
        () => tip() !== undefined,
        (showing) => {
            if (!showing) return
            const onKey = (event: KeyboardEvent) => {
                if (event.key === 'Escape') hideTip()
            }
            document.addEventListener('keydown', onKey)
            return () => document.removeEventListener('keydown', onKey)
        },
    )
    return (
        <aside
            ref={(el) => (aside = el)}
            class={`side-nav${collapsed() ? ' side-nav--collapsed' : ''}`}
            aria-busy={props.loading ? 'true' : undefined}
            onPointerOver={showTip}
            onFocusIn={showTip}
            onPointerLeave={hideTip}
            onFocusOut={hideTip}
            onClick={(event) => {
                // Following a link, or a button that opens a dialog, is going somewhere.
                if (overlayOpen() && (event.target as Element).closest(GOES_SOMEWHERE)) dismiss()
            }}
        >
            <Show
                when={props.loading}
                fallback={
                    <>
                        <div class="side-nav__profile">
                            <Show
                                when={props.menu}
                                fallback={
                                    <>
                                        <span class="side-nav__monogram t-meta" aria-hidden="true">
                                            {monogram(props.userName ?? '')}
                                        </span>
                                        <span class="side-nav__name t-cell">{props.userName}</span>
                                    </>
                                }
                            >
                                {(menu) => (
                                    <Popover
                                        label="Account menu"
                                        role="menu"
                                        align="start"
                                        presentation="auto"
                                        trigger={(trigger) => (
                                            <button
                                                type="button"
                                                class="side-nav__account"
                                                aria-label="Account menu"
                                                data-tip={collapsed() ? 'Account menu' : undefined}
                                                {...trigger}
                                            >
                                                <span class="side-nav__monogram t-meta" aria-hidden="true">
                                                    {monogram(props.userName ?? '')}
                                                </span>
                                                <span class="side-nav__name t-cell">{props.userName}</span>
                                            </button>
                                        )}
                                    >
                                        <div class="row-menu">{menu()}</div>
                                    </Popover>
                                )}
                            </Show>
                            <button
                                type="button"
                                class="side-nav__collapse t-meta"
                                aria-expanded={collapsed() ? 'false' : 'true'}
                                aria-label={collapsed() ? 'Expand sidebar' : 'Collapse sidebar'}
                                data-tip={collapsed() ? 'Expand sidebar' : undefined}
                                ref={(el) => (toggleButton = el)}
                                onClick={toggle}
                            >
                                <Icon name={collapsed() ? 'chevron-right-duo' : 'chevron-left-duo'} size={16} />
                            </button>
                        </div>
                        <Show when={props.teams}>
                            {(teams) => (
                                <div
                                    class="side-nav__teams"
                                    data-tip={collapsed() ? `Team: ${teamName(teams())}` : undefined}
                                >
                                    {/* Collapsed: the team's avatar is what shows, and the
                                        real select sits invisibly on top of it, so it still
                                        opens, still has its keyboard and its name. */}
                                    <Show when={collapsed()}>
                                        <span class="side-nav__team-avatar" aria-hidden="true">
                                            <Avatar
                                                initials={initialsOf(teamName(teams()))}
                                                label={`Team: ${teamName(teams())}`}
                                                size={32}
                                            />
                                        </span>
                                    </Show>
                                    <Select
                                        label="Team"
                                        icon={collapsed() ? undefined : 'team'}
                                        value={teams().value}
                                        options={teams().options}
                                        onChange={teams().onChange}
                                    />
                                </div>
                            )}
                        </Show>
                        <Show when={props.search}>
                            {(search) => (
                                <button
                                    type="button"
                                    class="side-nav__link side-nav__search t-body"
                                    aria-keyshortcuts={search().hint ? 'Control+K Meta+K' : undefined}
                                    aria-label="Search"
                                    data-tip={collapsed() ? 'Search' : undefined}
                                    onClick={(event) => search().onClick(event.currentTarget)}
                                >
                                    <Icon class="side-nav__icon" name="search" />
                                    <span class="side-nav__label">Search</span>
                                    <Show when={search().hint}>
                                        {(hint) => (
                                            <kbd class="shortcut-hint side-nav__hint t-meta" aria-hidden="true">
                                                {hint()}
                                            </kbd>
                                        )}
                                    </Show>
                                </button>
                            )}
                        </Show>
                        <nav aria-label="Main">
                            <hr class="side-nav__divider" aria-hidden="true" />
                            <ul class="side-nav__list">
                                <For each={props.links}>
                                    {(link) => <NavLink link={link} collapsed={collapsed()} />}
                                </For>
                            </ul>
                            <Show when={props.projects !== undefined}>
                                <hr class="side-nav__divider" aria-hidden="true" />
                                <h2 class="side-nav__heading t-meta">Projects</h2>
                                <ul class="side-nav__list">
                                    <For
                                        each={props.projects}
                                        fallback={
                                            <li class="side-nav__empty t-meta">No projects yet</li>
                                        }
                                    >
                                        {(link) => (
                                            <NavLink
                                                link={{ ...link, icon: link.icon ?? 'project', initials: initialsOf(link.label) }}
                                                collapsed={collapsed()}
                                            />
                                        )}
                                    </For>
                                </ul>
                            </Show>
                            <Show when={props.create && props.create.length > 0}>
                                <hr class="side-nav__divider" aria-hidden="true" />
                                <h2 class="side-nav__heading t-meta">Create</h2>
                                <ul class="side-nav__list" aria-label="Create">
                                    <For each={props.create}>
                                        {(item) => (
                                            <li>
                                                <Show when={item.disabledReason} fallback={<CreateButton item={item} collapsed={collapsed()} />}>
                                                    {(reason) => (
                                                        <Tooltip text={reason()}>
                                                            {(id) => (
                                                                <CreateButton item={item} collapsed={collapsed()} describedBy={id} />
                                                            )}
                                                        </Tooltip>
                                                    )}
                                                </Show>
                                            </li>
                                        )}
                                    </For>
                                </ul>
                                <Show when={props.create?.find((item) => item.disabledReason)?.disabledReason}>
                                    {(reason) => <p class="side-nav__empty t-meta">{reason()}</p>}
                                </Show>
                            </Show>
                            <Show when={props.views !== undefined}>
                                <hr class="side-nav__divider" aria-hidden="true" />
                                <h2 class="side-nav__heading t-meta">Saved views</h2>
                                <ul class="side-nav__list" aria-label="Saved views">
                                    <For
                                        each={props.views}
                                        fallback={<li class="side-nav__empty t-meta">No saved views yet</li>}
                                    >
                                        {(link) => (
                                            <NavLink
                                                link={{ ...link, icon: link.icon ?? 'views', initials: initialsOf(link.label) }}
                                                collapsed={collapsed()}
                                            />
                                        )}
                                    </For>
                                </ul>
                            </Show>
                        </nav>
                        <div class="side-nav__foot">
                            <hr class="side-nav__divider" aria-hidden="true" />
                            {props.account}
                            {props.status}
                            <Show when={props.help}>
                                {(help) => (
                                    <button
                                        type="button"
                                        class="side-nav__link side-nav__help t-body"
                                        aria-keyshortcuts={help().hint ? '?' : undefined}
                                        aria-label="Keyboard shortcuts"
                                        data-tip={collapsed() ? 'Keyboard shortcuts' : undefined}
                                        onClick={() => help().onClick()}
                                    >
                                        <Icon class="side-nav__icon" name="keyboard" />
                                        <span class="side-nav__label">Keyboard shortcuts</span>
                                        <Show when={help().hint}>
                                            {(hint) => (
                                                <kbd class="shortcut-hint side-nav__hint t-meta" aria-hidden="true">
                                                    {hint()}
                                                </kbd>
                                            )}
                                        </Show>
                                    </button>
                                )}
                            </Show>
                            <Show when={props.settings}>
                                {(settings) => (
                                    <a
                                        class="side-nav__link side-nav__settings t-body"
                                        href={settings().href}
                                        aria-keyshortcuts={settings().hint?.replace(' then ', ' ')}
                                        aria-label="Settings"
                                        data-tip={collapsed() ? 'Settings' : undefined}
                                    >
                                        <Icon class="side-nav__icon" name="settings" />
                                        <span class="side-nav__label">Settings</span>
                                        <Show when={settings().hint}>
                                            {(hint) => (
                                                <kbd class="shortcut-hint side-nav__hint t-meta" aria-hidden="true">
                                                    {hint()}
                                                </kbd>
                                            )}
                                        </Show>
                                    </a>
                                )}
                            </Show>
                            <Show when={props.userName}>
                                <button
                                    type="button"
                                    class="side-nav__logout t-body"
                                    aria-label="Log out"
                                    data-tip={collapsed() ? 'Log out' : undefined}
                                    onClick={props.onLogout}
                                >
                                    <Icon class="side-nav__icon" name="logout" />
                                    <span class="side-nav__label">Log out</span>
                                </button>
                            </Show>
                        </div>
                    </>
                }
            >
                {/* The one announcement. The main area has its own, and the two
                    are different regions saying different things. */}
                <p class="visually-hidden" role="status">
                    Loading navigation…
                </p>
                <div class="side-nav__profile" aria-hidden="true">
                    <SkeletonCircle size="26px" />
                    <SkeletonLine width="110px" height="12px" />
                </div>
                <nav aria-label="Main">
                    <ul class="side-nav__list" aria-hidden="true">
                        <For each={props.links}>
                            {() => (
                                <li>
                                    <div class="side-nav__link side-nav__link--loading">
                                        <SkeletonCircle size="20px" />
                                        <SkeletonLine width="64px" height="12px" />
                                    </div>
                                </li>
                            )}
                        </For>
                    </ul>
                </nav>
                <div class="side-nav__foot" aria-hidden="true">
                    <div class="side-nav__logout side-nav__link--loading">
                        <SkeletonLine width="56px" height="12px" />
                    </div>
                </div>
            </Show>
            <Show when={tip()}>
                {(t) => (
                    // The name is already on the control; this is for the eyes, so it is
                    // hidden from screen readers rather than read out twice.
                    <div
                        class="side-nav__tip t-meta"
                        aria-hidden="true"
                        style={{ top: `${t().top}px`, left: `${t().left}px` }}
                    >
                        {t().text}
                    </div>
                )}
            </Show>
        </aside>
    )
}

type CreateItem = NonNullable<SideNavProps['create']>[number]

function CreateButton(props: { item: CreateItem; collapsed: boolean; describedBy?: string }) {
    return (
        <button
            type="button"
            class="side-nav__link side-nav__create t-body"
            aria-label={props.item.label}
            data-tip={props.collapsed && !props.describedBy ? props.item.label : undefined}
            disabled={props.item.disabledReason !== undefined}
            aria-describedby={props.describedBy}
            onClick={() => props.item.onClick()}
        >
            <svg
                class="side-nav__icon"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                <Show when={props.item.icon}>
                    {(icon) => (
                        <g transform="scale(0.75)" stroke-width="2.6">
                            <path d={ICON_PATHS[icon()]} />
                        </g>
                    )}
                </Show>
                <path d={PLUS_BADGE} stroke-width="2" />
            </svg>
            <span class="side-nav__label">{props.item.label}</span>
        </button>
    )
}

const teamName = (teams: SideNavTeams) => teams.options.find((o) => o.value === teams.value)?.label ?? ''

function NavLink(props: { link: SideNavLink; collapsed: boolean }) {
    // The name a screen reader and the rail tooltip give: "Mine, private view".
    const name = () => {
        const { label, scope, note } = props.link
        if (scope) return `${label}, ${scope} view`
        return note ? `${label} ${note}` : label
    }
    return (
        <li>
            <a
                class="side-nav__link t-body"
                href={props.link.href}
                aria-keyshortcuts={props.link.hint?.replace(' then ', ' ')}
                aria-label={name()}
                data-tip={props.collapsed ? name() : undefined}
            >
                <Show
                    when={props.collapsed && props.link.initials}
                    fallback={<Icon class="side-nav__icon" name={props.link.icon ?? 'home'} />}
                >
                    {(initials) => (
                        <span class="side-nav__icon side-nav__initials" aria-hidden="true">
                            {initials()}
                        </span>
                    )}
                </Show>
                <span class="side-nav__label">{props.link.label}</span>
                <Show when={props.link.scope === 'private'}>
                    {/* Expanded: after the label. Collapsed: a badge on the initials. */}
                    <Icon class="side-nav__scope" name="key" size={14} />
                </Show>
                <Show when={props.link.hint}>
                    {(hint) => (
                        <kbd class="shortcut-hint side-nav__hint t-meta" aria-hidden="true">
                            {hint()}
                        </kbd>
                    )}
                </Show>
                <Show when={props.link.note}>
                    {' '}
                    <span class="side-nav__note t-meta">{props.link.note}</span>
                </Show>
            </a>
        </li>
    )
}
