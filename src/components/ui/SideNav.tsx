import type { JSX } from '@solidjs/web'
import { createSignal, For, Show } from 'solid-js'

import { Avatar } from './Avatar'
import { Icon, ICON_PATHS, type IconName } from './icons/Icon'
import { Select, type SelectOption } from './Select'
import { SkeletonCircle, SkeletonLine } from './Skeleton'
import { NARROW_QUERY, TABLET_QUERY, useMediaQuery } from './useNarrowScreen'
import './SideNav.css'

// A create action wears the icon of the thing it makes, shrunk, with a plus in
// the corner: "New epic" is not mistaken for "New sprint" when only icons show.
const PLUS_BADGE = 'M19 16v6M16 19h6'

// The user's own choice to collapse or expand the rail, kept across visits. It
// is only written when they press the button, so "nothing stored" still means
// "no preference" and the default (a rail on a tablet) can apply.
const COLLAPSED_KEY = 'lf-side-nav-collapsed'

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
    create?: { label: string; onClick: () => void; /** The icon of the thing made. */ icon?: IconName }[]
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
    onLogout: () => void
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
    const collapsed = () => !phone() && (chosen() ?? tablet())
    const toggle = () => {
        const next = !collapsed()
        setChosen(next)
        storeCollapsed(next)
    }
    return (
        <aside
            class={`side-nav${collapsed() ? ' side-nav--collapsed' : ''}`}
            aria-busy={props.loading ? 'true' : undefined}
        >
            <Show
                when={props.loading}
                fallback={
                    <>
                        <div class="side-nav__profile">
                            <span class="side-nav__monogram t-meta" aria-hidden="true">
                                {monogram(props.userName ?? '')}
                            </span>
                            <span class="side-nav__name t-cell">{props.userName}</span>
                            <button
                                type="button"
                                class="side-nav__collapse t-meta"
                                aria-expanded={collapsed() ? 'false' : 'true'}
                                aria-label={collapsed() ? 'Expand sidebar' : 'Collapse sidebar'}
                                onClick={toggle}
                            >
                                <Icon name={collapsed() ? 'chevron-right-duo' : 'chevron-left-duo'} size={16} />
                            </button>
                        </div>
                        <Show when={props.teams}>
                            {(teams) => (
                                <div
                                    class="side-nav__teams"
                                    title={collapsed() ? `Team: ${teamName(teams())}` : undefined}
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
                                    title={collapsed() ? 'Search' : undefined}
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
                                                <button
                                                    type="button"
                                                    class="side-nav__link side-nav__create t-body"
                                                    title={collapsed() ? item.label : undefined}
                                                    onClick={() => item.onClick()}
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
                                                        <Show when={item.icon}>
                                                            {(icon) => (
                                                                <g transform="scale(0.75)" stroke-width="2.6">
                                                                    <path d={ICON_PATHS[icon()]} />
                                                                </g>
                                                            )}
                                                        </Show>
                                                        <path d={PLUS_BADGE} stroke-width="2" />
                                                    </svg>
                                                    <span class="side-nav__label">{item.label}</span>
                                                </button>
                                            </li>
                                        )}
                                    </For>
                                </ul>
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
                            <Show when={props.userName}>
                                <button
                                    type="button"
                                    class="side-nav__logout t-body"
                                    title={collapsed() ? 'Log out' : undefined}
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
        </aside>
    )
}

const teamName = (teams: SideNavTeams) => teams.options.find((o) => o.value === teams.value)?.label ?? ''

function NavLink(props: { link: SideNavLink; collapsed: boolean }) {
    return (
        <li>
            <a
                class="side-nav__link t-body"
                href={props.link.href}
                aria-keyshortcuts={props.link.hint?.replace(' then ', ' ')}
                title={props.collapsed ? props.link.label : undefined}
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
