import { createSignal, onSettled, type Accessor } from 'solid-js'

/** Below this width the sidebar is a drawer instead of a rail. Keep in step
 *  with the `max-width` in AppShell.css. */
export const NARROW_QUERY = '(max-width: 767px)'

/** A tablet: the rail fits beside the content, but the full-width sidebar
 *  leaves too little of it (LAM-185). Keep in step with AppShell.css. */
export const TABLET_QUERY = '(min-width: 768px) and (max-width: 1024px)'

// Whether a media query matches, read once at creation so the first paint is
// already the right layout, then kept current as the window is resized or
// turned. Where there is no `matchMedia` (a test environment) it never matches.
export function useMediaQuery(queryText: string): Accessor<boolean> {
    const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(queryText) : undefined
    const [matches, setMatches] = createSignal(query?.matches ?? false)
    onSettled(() => {
        if (!query) return
        const update = () => setMatches(query.matches)
        update()
        query.addEventListener('change', update)
        return () => query.removeEventListener('change', update)
    })
    return matches
}

// A phone-width screen.
export function useNarrowScreen(): Accessor<boolean> {
    return useMediaQuery(NARROW_QUERY)
}
