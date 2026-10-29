import type { JSX } from '@solidjs/web'
import { createSignal, For, Show } from 'solid-js'

import { Select, type SelectOption } from './Select'
import { SkeletonCircle, SkeletonLine } from './Skeleton'
import './SideNav.css'

// Interface/House_02.svg, the Home icon from the Nav Links specimen. The default
// for a link that names no icon of its own.
const HOME_PATH =
    'M4 11.4522V16.8002C4 17.9203 4 18.4807 4.21799 18.9086C4.40973 19.2849 4.71547 19.5906 5.0918 19.7823C5.5192 20.0001 6.07899 20.0001 7.19691 20.0001H16.8031C17.921 20.0001 18.48 20.0001 18.9074 19.7823C19.2837 19.5906 19.5905 19.2849 19.7822 18.9086C20 18.4811 20 17.9216 20 16.8037V11.4522C20 10.9179 19.9995 10.6506 19.9346 10.4019C19.877 10.1816 19.7825 9.97307 19.6546 9.78464C19.5102 9.57201 19.3096 9.39569 18.9074 9.04383L14.1074 4.84383C13.3608 4.19054 12.9875 3.86406 12.5674 3.73982C12.1972 3.63035 11.8026 3.63035 11.4324 3.73982C11.0126 3.86397 10.6398 4.19014 9.89436 4.84244L5.09277 9.04383C4.69064 9.39569 4.49004 9.57201 4.3457 9.78464C4.21779 9.97307 4.12255 10.1816 4.06497 10.4019C4 10.6506 4 10.9179 4 11.4522Z'

/** Simple 24px stroke paths for the destinations that are not Home. */
export const ICONS = {
    list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    document: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
    views: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    epic: 'M13 3 5 13h6l-1 8 8-10h-6z',
    sprint: 'M12 8v4l3 2M21 12a9 9 0 1 1-3-6.7M21 4v5h-5',
    milestone: 'M6 21V4M6 5h12l-2 4 2 4H6',
    project: 'M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z',
} as const

export type SideNavLink = {
    label: string
    href: string
    /** An SVG path (24px grid). Home when absent. */
    icon?: string
    /** A word after the label, such as "Private". Quiet, and read out with it. */
    note?: string
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
    create?: { label: string; onClick: () => void }[]
    /** The signed-in user. Absent while it is not known yet, which draws an
     *  empty profile slot rather than a different layout. */
    userName?: string
    /** Sits at the foot of the rail, above the log-out button: a quiet status
     *  such as the connection indicator. Optional, and the caller's to fill. */
    status?: JSX.Element
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
    const [collapsed, setCollapsed] = createSignal(false)
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
                                onClick={() => setCollapsed(!collapsed())}
                            >
                                {collapsed() ? '»' : '«'}
                            </button>
                        </div>
                        <Show when={props.teams}>
                            {(teams) => (
                                <div class="side-nav__teams">
                                    <Select
                                        label="Team"
                                        value={teams().value}
                                        options={teams().options}
                                        onChange={teams().onChange}
                                    />
                                </div>
                            )}
                        </Show>
                        <nav aria-label="Main">
                            <ul class="side-nav__list">
                                <For each={props.links}>
                                    {(link) => <NavLink link={link} collapsed={collapsed()} />}
                                </For>
                            </ul>
                            <Show when={props.projects !== undefined}>
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
                                                link={{ ...link, icon: link.icon ?? ICONS.project }}
                                                collapsed={collapsed()}
                                            />
                                        )}
                                    </For>
                                </ul>
                            </Show>
                            <Show when={props.create && props.create.length > 0}>
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
                                                    <span class="side-nav__icon" aria-hidden="true">+</span>
                                                    <span class="side-nav__label">{item.label}</span>
                                                </button>
                                            </li>
                                        )}
                                    </For>
                                </ul>
                            </Show>
                            <Show when={props.views !== undefined}>
                                <h2 class="side-nav__heading t-meta">Saved views</h2>
                                <ul class="side-nav__list" aria-label="Saved views">
                                    <For
                                        each={props.views}
                                        fallback={<li class="side-nav__empty t-meta">No saved views yet</li>}
                                    >
                                        {(link) => (
                                            <NavLink
                                                link={{ ...link, icon: link.icon ?? ICONS.views }}
                                                collapsed={collapsed()}
                                            />
                                        )}
                                    </For>
                                </ul>
                            </Show>
                        </nav>
                        <div class="side-nav__foot">
                            {props.status}
                            <Show when={props.userName}>
                                <button
                                    type="button"
                                    class="side-nav__logout t-body"
                                    onClick={props.onLogout}
                                >
                                    Log out
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

function NavLink(props: { link: SideNavLink; collapsed: boolean }) {
    return (
        <li>
            <a
                class="side-nav__link t-body"
                href={props.link.href}
                title={props.collapsed ? props.link.label : undefined}
            >
                <svg
                    class="side-nav__icon"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                >
                    <path
                        d={props.link.icon ?? HOME_PATH}
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                </svg>
                <span class="side-nav__label">{props.link.label}</span>
                <Show when={props.link.note}>
                    {' '}
                    <span class="side-nav__note t-meta">{props.link.note}</span>
                </Show>
            </a>
        </li>
    )
}
