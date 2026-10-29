import { handlerFor, SHORTCUTS, type ShortcutDef } from './registry'

// The chord's second key has this long.
export const CHORD_MS = 1000

const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]'
// A modal dialog is open: the Modal, the search palette, the help sheet.
const MODAL = '[aria-modal="true"]'
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'])

function typingInto(target: EventTarget | null): boolean {
    return target instanceof Element && (target.closest(TYPING) !== null || (target as HTMLElement).isContentEditable === true)
}

/** The key as the registry writes it: `c`, `?`, `mod+k`, or undefined for a
 *  press that is never ours (Alt, Ctrl/Cmd with anything but its own chord). */
export function keyOf(event: KeyboardEvent): string | undefined {
    if (event.altKey) return undefined
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    if (event.ctrlKey || event.metaKey) {
        return (event.ctrlKey && event.metaKey) || event.shiftKey ? undefined : `mod+${key}`
    }
    return key
}

const steps = (def: ShortcutDef) => def.keys.split(' ')
const listenable = SHORTCUTS.filter((def): def is (typeof SHORTCUTS)[number] => !('local' in def && def.local))

/** The one keydown listener for the app. Returns the function that removes it. */
export function installShortcutListener(target: Document = document): () => void {
    let pending: string | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    function clearChord() {
        pending = undefined
        clearTimeout(timer)
    }

    function onKeyDown(event: KeyboardEvent) {
        if (MODIFIER_KEYS.has(event.key) || event.isComposing) return
        const key = keyOf(event)
        if (key === undefined) {
            clearChord()
            return
        }
        const chord = key.startsWith('mod+')
        // A chord with Ctrl/Cmd cannot be typed as text, so it works from a
        // field and above a dialog; a bare key is the user's text or the
        // dialog's own.
        const blocked =
            !chord &&
            (event.defaultPrevented || event.repeat || typingInto(event.target) || document.querySelector(MODAL) !== null)
        if (blocked) {
            clearChord()
            return
        }

        const first = pending
        clearChord()
        const hit = listenable.find((def) => {
            const s = steps(def)
            if (first !== undefined) return s.length === 2 && s[0] === first && s[1] === key
            return s.length === 1 && s[0] === key
        })
        if (hit) {
            const run = handlerFor(hit.id)
            if (!run) return
            event.preventDefault()
            run()
            return
        }
        // Not a finished shortcut: maybe the first key of a sequence that is on offer.
        if (first === undefined) {
            const starts = listenable.some((def) => steps(def).length === 2 && steps(def)[0] === key && handlerFor(def.id))
            if (starts) {
                pending = key
                timer = setTimeout(clearChord, CHORD_MS)
            }
        }
    }

    target.addEventListener('keydown', onKeyDown)
    return () => {
        clearChord()
        target.removeEventListener('keydown', onKeyDown)
    }
}
