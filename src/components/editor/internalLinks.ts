import { createSignal } from 'solid-js'
import type { JSX } from '@solidjs/web'

/*
┌─ components/editor ─────────────────────────────
│  internal links: what they look like stored, in the address bar, and how the
│  editor reaches the app for titles, navigation and the picker (LAM-108)
├─ out ───────────────────────────────────────────
│      LinkKind · LinkRef · LinkTarget   what a link points at
│      lfHref(ref) · routeOf(ref)        the stored URL · the app route
│      parseInternal(url, origin?)       lf://, or an app URL of this origin → LinkRef
│      editorLinks() · setEditorLinks()  the app's side of it (set by the shell)
│      onTitlesChanged(fn) · titlesChanged()  chips redraw when the app says titles moved
├─ example ───────────────────────────────────────
│      lfHref({ kind: 'ticket', id: 'a1' })              →  'lf://ticket/a1'
│      parseInternal('https://app.test/documents/d1', 'https://app.test')  →  { kind: 'document', id: 'd1' }
*/
// ADR 0006: an internal link is stored as a Markdown link whose URL is
// `lf://<kind>/<id>`. The app route is derived from it, never stored, so a
// route can change without touching any document.

export type LinkKind = 'ticket' | 'document' | 'project'
export type LinkRef = { kind: LinkKind; id: string }
export type LinkTarget = LinkRef & { title: string }

export const LINK_KINDS: readonly LinkKind[] = ['ticket', 'document', 'project']

const ROUTES: Record<LinkKind, string> = { ticket: '/tickets/', document: '/documents/', project: '/projects/' }
const ID = '[^/\\s?#]+'
const LF = new RegExp(`^lf://(ticket|document|project)/(${ID})$`)
const PATH = new RegExp(`^/(tickets|documents|projects)/(${ID})/?$`)
const PLURAL: Record<string, LinkKind> = { tickets: 'ticket', documents: 'document', projects: 'project' }

export const lfHref = (ref: LinkRef) => `lf://${ref.kind}/${ref.id}`
export const routeOf = (ref: LinkRef) => `${ROUTES[ref.kind]}${ref.id}`

/** The thing a URL points at inside this app, or null for any other URL. Takes
 *  the stored `lf://` form and the app's own address (a URL copied from the
 *  address bar). Another site's `/tickets/x` is an external link. */
export function parseInternal(url: string, origin: string = globalThis.location?.origin ?? ''): LinkRef | null {
    const text = url.trim()
    const stored = LF.exec(text)
    if (stored) return { kind: stored[1] as LinkKind, id: stored[2] }
    if (!origin || !text.startsWith(origin)) return null
    let path: string
    try {
        const parsed = new URL(text)
        if (parsed.origin !== origin) return null
        path = parsed.pathname
    } catch {
        return null
    }
    const found = PATH.exec(path)
    return found ? { kind: PLURAL[found[1]], id: decodeURIComponent(found[2]) } : null
}

export type LinkPickerProps = {
    onPick: (target: LinkTarget) => void
    onClose: () => void
}

/** What the app gives the editor. The editor lives in `components`, which may
 *  not know about tickets or routes, so the shell registers these. */
export type EditorLinks = {
    /** The target's current title, or undefined if it is not in the local store.
     *  Reads reactive state: a rename shows in chips already on screen. */
    titleOf: (ref: LinkRef) => string | undefined
    /** Goes to a route without reloading the page. */
    open: (route: string) => void
    /** The dialog that searches what can be linked. */
    picker: (props: LinkPickerProps) => JSX.Element
}

const [links, setLinks] = createSignal<EditorLinks | null>(null)

// A chip is drawn by ProseMirror, outside any reactive owner (the editor is
// built where Solid forbids creating effects), so it cannot track `titleOf`.
// The app says when titles may have moved, and each chip on screen redraws.
const listeners = new Set<() => void>()

/** Calls `fn` whenever titles may have changed. Returns how to stop. */
export function onTitlesChanged(fn: () => void): () => void {
    listeners.add(fn)
    return () => void listeners.delete(fn)
}
export const titlesChanged = () => listeners.forEach((fn) => fn())

export const editorLinks = links
export const setEditorLinks = (next: EditorLinks | null) => {
    setLinks(next)
    titlesChanged()
}
