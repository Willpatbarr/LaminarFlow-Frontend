import type { RouteSectionProps } from '@solidjs/router'

export function RootLayout(props: RouteSectionProps) {
    return (
        <>
            <nav>
                {/* Solid Router has no link component: this is a plain anchor
                    and the router intercepts the click. The href is a literal
                    because router.tsx imports this file, so importing
                    `router.paths` back here would be an import cycle. */}
                <a href="/">LaminarFlow</a>
            </nav>
            <main>{props.children}</main>
        </>
    )
}
