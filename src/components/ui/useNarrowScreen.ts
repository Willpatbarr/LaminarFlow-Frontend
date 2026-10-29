import { createSignal, onSettled, type Accessor } from 'solid-js'

/** Below this width the sidebar is a drawer instead of a rail. Keep in step
 *  with the `max-width` in AppShell.css. */
export const NARROW_QUERY = '(max-width: 767px)'

// A phone-width screen. Read once at creation so the first paint is already the
// right layout, then kept current as the window is resized or turned. Where
// there is no `matchMedia` (a test environment) the screen is never narrow.
export function useNarrowScreen(): Accessor<boolean> {
    const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(NARROW_QUERY) : undefined
    const [narrow, setNarrow] = createSignal(query?.matches ?? false)
    onSettled(() => {
        if (!query) return
        const update = () => setNarrow(query.matches)
        update()
        query.addEventListener('change', update)
        return () => query.removeEventListener('change', update)
    })
    return narrow
}
