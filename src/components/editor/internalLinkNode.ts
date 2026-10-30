import { mergeAttributes, Node } from '@tiptap/core'
import Link from '@tiptap/extension-link'
import { Plugin, PluginKey } from '@tiptap/pm/state'

import { editorLinks, lfHref, onTitlesChanged, parseInternal, routeOf, type LinkKind, type LinkRef } from './internalLinks'

/*
┌─ components/editor ─────────────────────────────
│  the chip: an internal link drawn as a small inline pill (LAM-108)
├─ out ───────────────────────────────────────────
│      InternalLink   the TipTap node (the list that makes one is linkSuggest.ts)
├─ example ───────────────────────────────────────
│      [Plan](lf://ticket/a1)   ⇄   the chip "Plan" (or the ticket's current title)
*/
// The stored form never changes: a chip is `[label](lf://kind/id)` in the
// Markdown, so it round-trips as a plain link (and any other Markdown reader
// sees a link). The label is what the author saw when inserting; on screen the
// chip shows the target's current title when the local store has it, and the
// label when it does not (not synced yet, or deleted).
//
// It is an atom: one unit for the cursor and for Backspace, never edited
// character by character. Its parse handler sits ahead of the Link mark's for
// the same Markdown token, and answers only for `lf://` links.

const escapeLabel = (label: string) => label.replace(/[\\[\]]/g, '\\$&')

function fallbackLabel(kind: LinkKind) {
    return kind[0].toUpperCase() + kind.slice(1)
}

export function chipLabel(ref: LinkRef): string {
    return editorLinks()?.titleOf(ref) ?? fallbackLabel(ref.kind)
}

export const InternalLink = Node.create({
    name: 'internalLink',
    priority: 1000,
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,

    addAttributes() {
        return {
            kind: { default: 'ticket', rendered: false },
            id: { default: '', rendered: false },
            label: { default: '', rendered: false },
        }
    },

    parseHTML() {
        return [
            {
                tag: 'a[data-lf-kind]',
                getAttrs: (el) => ({
                    kind: el.getAttribute('data-lf-kind'),
                    id: el.getAttribute('data-lf-id'),
                    label: el.textContent ?? '',
                }),
            },
        ]
    },

    renderHTML({ node, HTMLAttributes }) {
        const ref = { kind: node.attrs.kind as LinkKind, id: node.attrs.id as string }
        return [
            'a',
            mergeAttributes(HTMLAttributes, {
                class: 'lf-chip',
                href: routeOf(ref),
                'data-lf-kind': ref.kind,
                'data-lf-id': ref.id,
            }),
            node.attrs.label || fallbackLabel(ref.kind),
        ]
    },

    renderText({ node }) {
        return node.attrs.label as string
    },

    renderMarkdown: (node) => {
        const ref = { kind: node.attrs?.kind as LinkKind, id: node.attrs?.id as string }
        return `[${escapeLabel(String(node.attrs?.label || fallbackLabel(ref.kind)))}](${lfHref(ref)})`
    },

    addNodeView() {
        return ({ node }) => {
            const ref = { kind: node.attrs.kind as LinkKind, id: node.attrs.id as string }
            const dom = document.createElement('a')
            dom.className = 'lf-chip'
            dom.href = routeOf(ref)
            dom.dataset.lfKind = ref.kind
            dom.dataset.lfId = ref.id
            dom.contentEditable = 'false'
            const text = document.createElement('span')
            dom.append(text)
            // The title follows the store for as long as the chip is on screen.
            const redraw = () => {
                text.textContent = editorLinks()?.titleOf(ref) ?? (node.attrs.label || fallbackLabel(ref.kind))
            }
            redraw()
            const stop = onTitlesChanged(redraw)
            dom.addEventListener('click', (event) => {
                const links = editorLinks()
                if (!links || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                event.preventDefault()
                links.open(routeOf(ref))
            })
            return { dom, destroy: stop }
        }
    },

    addProseMirrorPlugins() {
        const { editor } = this
        const insertChip = (ref: LinkRef, at?: number) => {
            const chip = { type: 'internalLink', attrs: { ...ref, label: chipLabel(ref) } }
            return editor.chain().focus().insertContentAt(at ?? editor.state.selection.from, [chip]).run()
        }
        return [
            new Plugin({
                key: new PluginKey('internalLink'),
                props: {
                    // A lone internal URL (copied from the address bar, or the stored
                    // lf:// form) becomes a chip. Anything else is not ours.
                    handlePaste(_view, event) {
                        const text = event.clipboardData?.getData('text/plain')?.trim() ?? ''
                        if (!text || /\s/.test(text)) return false
                        const ref = parseInternal(text)
                        if (!ref) return false
                        insertChip(ref)
                        return true
                    },
                },
            }),
        ]
    },
})

/** The Link mark, except that a `lf://` link in Markdown becomes a chip. The
 *  Markdown parser asks one handler per token type, so this has to be the
 *  Link's own handler rather than a second one beside it. Other links, and
 *  writing any link out, are the mark's as before. */
export const LinkOrChip = Link.extend({
    parseMarkdown(token, helpers) {
        const ref = parseInternalHref(token.href)
        if (!ref) return this.parent?.(token, helpers) ?? []
        return { type: 'internalLink', attrs: { ...ref, label: String(token.text ?? '') } }
    },
})

function parseInternalHref(href: unknown): LinkRef | null {
    return typeof href === 'string' && href.startsWith('lf://') ? parseInternal(href) : null
}
