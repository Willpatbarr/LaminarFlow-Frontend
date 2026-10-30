import { Extension, type Editor, type Range } from '@tiptap/core'
import { exitSuggestion, Suggestion } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'

import type { LinkTarget } from './internalLinks'

/*
┌─ components/editor ─────────────────────────────
│  typing `@` or `[[` opens the link list at the caret (LAM-146)
├─ out ───────────────────────────────────────────
│      LinkSuggest                 the TipTap extension; reports an open list as a Session
│      Session                     what the open list needs: query, caret rect, pick, dismiss
│      matchTargets(all, q, n)     the targets whose title contains q, at most n
│      keyAction(event, at, n)     what a key does to a list of n options
├─ example ───────────────────────────────────────
│      keyAction(ArrowDown, 0, 3)  →  { move: 1 }       keyAction(Enter, 1, 3)  →  'pick'
*/
// The text stays in the document while the list is open (`@pro` is ordinary
// text), so Escape just closes the list and leaves it. Picking replaces the
// trigger and what was typed after it with the chip and a space. The editor
// keeps focus the whole time: the list is driven from the keydown handler here.

/** The most options listed; narrowing the query brings the rest. */
export const SHOWN = 50

export type Session = {
    query: string
    /** The caret, in viewport coordinates, read when the list is placed. */
    rect: () => DOMRect | null
    pick: (target: LinkTarget) => void
    dismiss: () => void
}

export type KeyAction = 'pick' | 'none' | { move: number }

export function matchTargets(all: LinkTarget[], query: string, limit = SHOWN): LinkTarget[] {
    const needle = query.trim().toLowerCase()
    const found: LinkTarget[] = []
    for (const target of all) {
        if (needle !== '' && !target.title.toLowerCase().includes(needle)) continue
        found.push(target)
        if (found.length === limit) break
    }
    return found
}

/** ↑/↓ move (wrapping), Enter and Tab pick. Anything else, or any of these with
 *  a modifier or mid-composition, is not ours; with no options Enter and Tab
 *  are left alone so they do what they always did. */
export function keyAction(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing'>, at: number, count: number): KeyAction {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) return 'none'
    if (count === 0) return 'none'
    switch (event.key) {
        case 'ArrowDown':
            return { move: (at + 1) % count }
        case 'ArrowUp':
            return { move: at <= 0 ? count - 1 : at - 1 }
        case 'Enter':
        case 'Tab':
            return 'pick'
        default:
            return 'none'
    }
}

type Options = {
    /** The list opened, changed (new query or caret), or closed (null). */
    onSession: (session: Session | null) => void
    /** A key went down while the list is open. True if the list used it. */
    onKey: (event: KeyboardEvent) => boolean
}

function insertChip(editor: Editor, range: Range, target: LinkTarget) {
    const after = editor.state.doc.textBetween(range.to, Math.min(range.to + 1, editor.state.doc.content.size), '\n', '\0')
    const content: object[] = [{ type: 'internalLink', attrs: { kind: target.kind, id: target.id, label: target.title } }]
    if (!/^\s/.test(after)) content.push({ type: 'text', text: ' ' })
    return editor.chain().focus().insertContentAt(range, content).run()
}

function trigger(editor: Editor, options: Options, name: string, char: string, anywhere: boolean) {
    const key = new PluginKey(name)
    return Suggestion<LinkTarget, LinkTarget>({
        editor,
        pluginKey: key,
        char,
        // Titles have spaces: the query runs on until a pick, Escape or a
        // delete back past the trigger.
        allowSpaces: true,
        // `@` only at the start of a word, so an address like a@b.c is just text.
        allowedPrefixes: anywhere ? null : [' ', '\n', '\t'],
        command: ({ editor: ed, range, props }) => void insertChip(ed, range, props),
        // Our own outside-press handling is the Popover's; the list is not mounted by TipTap.
        dismissOnOutsideClick: false,
        render: () => {
            const report = (props: { query: string; clientRect?: (() => DOMRect | null) | null; command: (t: LinkTarget) => void }) =>
                options.onSession({
                    query: props.query,
                    rect: () => props.clientRect?.() ?? null,
                    pick: (target) => props.command(target),
                    dismiss: () => exitSuggestion(editor.view, key),
                })
            return {
                onStart: report,
                onUpdate: report,
                onExit: () => options.onSession(null),
                onKeyDown: ({ event }) => options.onKey(event),
            }
        },
    })
}

/** Offers the app's linkable things at `@` and `[[`. Inert until the app registers them. */
export const LinkSuggest = Extension.create<Options>({
    name: 'linkSuggest',

    addOptions() {
        return { onSession: () => {}, onKey: () => false }
    },

    addProseMirrorPlugins() {
        const { editor, options } = this
        return [trigger(editor, options, 'linkSuggestAt', '@', false), trigger(editor, options, 'linkSuggestBrackets', '[[', true)]
    },
})
