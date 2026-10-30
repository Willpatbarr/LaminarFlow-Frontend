import { createSignal, onSettled } from 'solid-js'

import { can } from '@/features/auth'

/*
┌─ shortcuts ─────────────────────────────────────
│  registry: the one list of keyboard shortcuts, and what is bound to them (LAM-124)
├─ declares ──────────────────────────────────────
│      SHORTCUTS         every shortcut the app has: keys, words, scope, permission
│      useShortcut       bind a handler to one of them while a component is mounted
│      useScope          mark a scope active (for keys a component handles itself)
│      available         is this shortcut offered right now (bound, scope on, allowed)
│      listed            the shortcuts to show in the help sheet, by scope
│      keysOf, hintFor   how a shortcut is written on screen
├─ reached from ──────────────────────────────────
│      listener.ts (the one keydown listener), ShortcutHelp, hints beside buttons and links
└─────────────────────────────────────────────────
*/
// A shortcut is *declared* here and *bound* where the thing it does lives. The
// declaration is what the help sheet and the hints are drawn from, so a key
// that works is a key that is listed; the binding is a handler a mounted
// component hands in, so a key whose screen is not open does nothing and is not
// listed. Nothing here knows how to create a ticket or open a page.

export type Scope = 'global' | 'list' | 'ticket' | 'board'

/** Headings for the help sheet, in the order they are shown. */
export const SCOPES: { scope: Scope; heading: string }[] = [
    { scope: 'global', heading: 'Anywhere' },
    { scope: 'list', heading: 'Ticket list' },
    { scope: 'ticket', heading: 'A ticket' },
    { scope: 'board', heading: 'Board' },
]

export type ShortcutDef = {
    id: string
    /** What to press. Space-separated steps are a sequence (`g t` is G, then
     *  T); `mod+` is Cmd on a Mac and Ctrl elsewhere. Plain keys only
     *  otherwise: nothing here uses Alt, and Ctrl/Cmd plus a letter is left to
     *  the browser except `mod+k`. */
    keys: string
    /** What it does, as the help sheet says it. */
    label: string
    scope: Scope
    /** The permission the account needs (LAM-117). Without it the shortcut is
     *  neither run nor listed. */
    permission?: string
    /** Fires from inside a field and above a dialog. Only for a chord that
     *  cannot be typed as text. */
    whileTyping?: boolean
    /** Handled by the component itself (a key on a focused card), not by the
     *  listener. Listed while its scope is active. */
    local?: boolean
    /** How to write it when `keys` cannot be (arrow keys, Space). */
    display?: string
}

export const SHORTCUTS = [
    { id: 'palette.toggle', keys: 'mod+k', label: 'Search tickets, documents and projects', scope: 'global', whileTyping: true },
    { id: 'help.open', keys: '?', label: 'Show keyboard shortcuts', scope: 'global' },
    { id: 'nav.tickets', keys: 'g t', label: 'Go to tickets', scope: 'global' },
    { id: 'nav.documents', keys: 'g d', label: 'Go to documents', scope: 'global' },
    { id: 'nav.board', keys: 'g b', label: 'Go to the board', scope: 'global' },
    { id: 'ticket.new', keys: 'c', label: 'New ticket', scope: 'global', permission: 'ticket:write' },
    { id: 'ticket.create', keys: 'mod+enter', label: 'Create the ticket, from any field of the New ticket dialog', scope: 'global', permission: 'ticket:write', local: true },
    { id: 'list.next', keys: 'j', label: 'Next ticket', scope: 'list' },
    { id: 'list.previous', keys: 'k', label: 'Previous ticket', scope: 'list' },
    { id: 'ticket.status', keys: 's', label: 'Change status', scope: 'ticket', permission: 'ticket:write' },
    { id: 'ticket.edit', keys: 'e', label: 'Edit the title', scope: 'ticket', permission: 'ticket:write' },
    { id: 'board.lift', keys: 'space', display: 'Space', label: 'Pick up or drop the focused card', scope: 'board', permission: 'ticket:write', local: true },
    { id: 'board.move', keys: 'arrows', display: '← ↑ ↓ →', label: 'Move the picked-up card', scope: 'board', permission: 'ticket:write', local: true },
    { id: 'board.cancel', keys: 'escape', display: 'Esc', label: 'Put the card back', scope: 'board', permission: 'ticket:write', local: true },
] as const satisfies readonly ShortcutDef[]

export type ShortcutId = (typeof SHORTCUTS)[number]['id']

export const definition = (id: ShortcutId): ShortcutDef => SHORTCUTS.find((def) => def.id === id)!

type Binding = { id: ShortcutId; run: () => void; enabled?: () => boolean }

// Plain module state, like the session store: the listener is not a component.
// The newest binding of an id wins, so a screen can take over a key a shell
// bound as a fallback, and hand it back by unmounting.
const bindings: Binding[] = []
// A binding's condition reads the screen's own state, which can already be
// torn down in the moment its owner unmounts. Then it is simply not enabled.
function on(binding: Binding): boolean {
    try {
        return binding.enabled?.() ?? true
    } catch {
        return false
    }
}
const scopes: Scope[] = []
// Only for the help sheet and the hints, which redraw when what is bound changes.
const [version, setVersion] = createSignal(0)
const touch = () => setVersion((v) => v + 1)

/** Binds `run` to a declared shortcut while the calling component is mounted.
 *  `enabled` is asked each time, for what only sometimes holds (a project
 *  exists, the ticket is not locked): when it says no, the key does nothing and
 *  the shortcut is not listed. */
export function useShortcut(id: ShortcutId, run: () => void, enabled?: () => boolean): void {
    onSettled(() => {
        const binding: Binding = { id, run, enabled }
        bindings.push(binding)
        touch()
        return () => {
            bindings.splice(bindings.indexOf(binding), 1)
            touch()
        }
    })
}

/** Marks `scope` active while the calling component is mounted. */
export function useScope(scope: Scope): void {
    onSettled(() => {
        scopes.push(scope)
        touch()
        return () => {
            scopes.splice(scopes.indexOf(scope), 1)
            touch()
        }
    })
}

/** The handler a key press for `id` should run now, if any. Not reactive: the
 *  listener asks at the moment of the press. */
export function handlerFor(id: ShortcutId): (() => void) | undefined {
    const permitted = !definition(id).permission || can(definition(id).permission!)
    if (!permitted) return undefined
    return bindings.findLast((b) => b.id === id && on(b))?.run
}

/** Is the shortcut on offer right now. Reactive. */
export function available(id: ShortcutId): boolean {
    version()
    const def = definition(id)
    if (def.permission && !can(def.permission)) return false
    if (def.local) return scopes.includes(def.scope)
    return bindings.some((b) => b.id === id && on(b))
}

/** What the help sheet shows: the available shortcuts, grouped by scope. */
export function listed(): { heading: string; items: { id: ShortcutId; keys: string; label: string }[] }[] {
    return SCOPES.map(({ scope, heading }) => ({
        heading,
        items: SHORTCUTS.filter((def) => def.scope === scope && available(def.id)).map((def) => ({
            id: def.id,
            keys: keysOf(def.id),
            label: def.label,
        })),
    })).filter((group) => group.items.length > 0)
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** The keys as written on screen: "G then T", "⌘K", "?". */
export function keysOf(id: ShortcutId): string {
    const def: ShortcutDef = definition(id)
    if (def.display) return def.display
    return def.keys
        .split(' ')
        .map((step) =>
            step
                .split('+')
                .map((key) => (key === 'mod' ? (isMac() ? '⌘' : 'Ctrl+') : key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1)))
                .join(''),
        )
        .join(' then ')
}

/** The text of a hint beside a button or link, or undefined when the shortcut
 *  is not on offer (so no hint promises a key that does nothing). Reactive. */
export function hintFor(id: ShortcutId): string | undefined {
    return available(id) ? keysOf(id) : undefined
}

/** For tests: forget every binding. */
export function resetShortcuts(): void {
    bindings.length = 0
    scopes.length = 0
    touch()
}
