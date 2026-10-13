import { For, Show } from 'solid-js'

import './SideNav.css'

// Interface/House_02.svg, the Home icon from the Nav Links specimen. It is the
// only icon here because the rail has only one destination so far; the rest of
// the specimen's icons arrive with the destinations that need them.
const HOME_PATH =
    'M4 11.4522V16.8002C4 17.9203 4 18.4807 4.21799 18.9086C4.40973 19.2849 4.71547 19.5906 5.0918 19.7823C5.5192 20.0001 6.07899 20.0001 7.19691 20.0001H16.8031C17.921 20.0001 18.48 20.0001 18.9074 19.7823C19.2837 19.5906 19.5905 19.2849 19.7822 18.9086C20 18.4811 20 17.9216 20 16.8037V11.4522C20 10.9179 19.9995 10.6506 19.9346 10.4019C19.877 10.1816 19.7825 9.97307 19.6546 9.78464C19.5102 9.57201 19.3096 9.39569 18.9074 9.04383L14.1074 4.84383C13.3608 4.19054 12.9875 3.86406 12.5674 3.73982C12.1972 3.63035 11.8026 3.63035 11.4324 3.73982C11.0126 3.86397 10.6398 4.19014 9.89436 4.84244L5.09277 9.04383C4.69064 9.39569 4.49004 9.57201 4.3457 9.78464C4.21779 9.97307 4.12255 10.1816 4.06497 10.4019C4 10.6506 4 10.9179 4 11.4522Z'

export type SideNavLink = {
    label: string
    href: string
}

type SideNavProps = {
    links: SideNavLink[]
    /** The signed-in user. Absent while it is not known yet, which draws an
     *  empty profile slot rather than a different layout. */
    userName?: string
    onLogout: () => void
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
export function SideNav(props: SideNavProps) {
    return (
        <aside class="side-nav">
            <div class="side-nav__profile">
                <span class="side-nav__monogram t-meta" aria-hidden="true">
                    {monogram(props.userName ?? '')}
                </span>
                <span class="side-nav__name t-cell">{props.userName}</span>
            </div>
            <nav aria-label="Main">
                <ul class="side-nav__list">
                    <For each={props.links}>
                        {(link) => (
                            <li>
                                <a class="side-nav__link t-body" href={link.href}>
                                    <svg
                                        class="side-nav__icon"
                                        width="20"
                                        height="20"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        aria-hidden="true"
                                    >
                                        <path
                                            d={HOME_PATH}
                                            stroke="currentColor"
                                            stroke-width="2"
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                        />
                                    </svg>
                                    {link.label}
                                </a>
                            </li>
                        )}
                    </For>
                </ul>
            </nav>
            <Show when={props.userName}>
                <button type="button" class="side-nav__logout t-body" onClick={props.onLogout}>
                    Log out
                </button>
            </Show>
        </aside>
    )
}
