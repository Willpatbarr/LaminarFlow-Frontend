import { createEffect, createSignal, onCleanup, untrack } from 'solid-js'

/*
┌─ documents ─────────────────────────────────────
│  autosave: a field that saves a moment after the typing stops
├─ out ───────────────────────────────────────────
│      createAutosave(saved, save, options) → { value, input, flush, dirty, reset }
│      AUTOSAVE_DELAY                      the quiet time before a save, in ms
├─ example ───────────────────────────────────────
│      const body = createAutosave(() => doc.body.content ?? '', (md) => updateDocument(id, { body: { content: md } }))
│      <MarkdownEditor value={body.value()} onChange={body.input} onBlur={body.flush} />
│  options: { delay, canSave() (false keeps the draft unsaved, e.g. blank title),
│             base() (the row's version, read when an edit starts and handed to save) }
*/
export const AUTOSAVE_DELAY = 800

export type AutosaveOptions = {
    delay?: number
    /** False while the draft must not be saved (blank, over a limit). The text
     *  stays in the field and nothing is queued; the next flush tries again. */
    canSave?: (value: string) => boolean
    /** The version of the row the edit starts from. Read on the first keystroke
     *  after the field was idle, kept until the draft has been saved, and given to
     *  `save` so a conflict check can name the version the user actually saw. */
    base?: () => number | null
    /** What the field is editing (a row id). Read on the first keystroke and kept
     *  with the draft: the save goes to that row even if the page has since been
     *  reused for another, and when it changes the draft is saved to the old row
     *  and dropped, so it never shows up on, or is written into, the new one. */
    key?: () => string
    /** Whether two keys name the same row (a new row's temporary id and its
     *  real one do). Defaults to equality. */
    same?: (a: string, b: string) => boolean
}

export type AutosaveContext = { base: number | null; key: string | null }

/** While the user is typing the field shows their draft and ignores the store,
 *  so a sync landing mid-word cannot overwrite it; once the store shows what
 *  was typed the draft is dropped and the field follows the store again. A save
 *  goes to the local store (so never waits on the network) after `delay` ms of
 *  quiet, on `flush` (focus leaving), when the page is left (route change or
 *  unmount) and on `beforeunload` / `pagehide` (tab closed or reloaded). */
export function createAutosave(
    saved: () => string,
    save: (value: string, context: AutosaveContext) => Promise<unknown>,
    options: AutosaveOptions | number = {},
) {
    const { delay = AUTOSAVE_DELAY, canSave, base, key, same = (a: string, b: string) => a === b } = typeof options === 'number' ? { delay: options } : options
    const [draft, setDraft] = createSignal<string | null>(null)
    let timer: ReturnType<typeof setTimeout> | undefined
    // Undefined while idle; set on the first keystroke of an edit.
    let editBase: number | null | undefined
    let editKey: string | null = null
    const sameRow = (k: string | null) => k !== null && same(k, untrack(key!))
    const current = () => draft() !== null && (!key || (editKey !== null && same(editKey, key())))

    async function flush() {
        clearTimeout(timer)
        timer = undefined
        const value = draft()
        if (value === null) return
        if (canSave && !canSave(value)) return
        if (value !== saved()) await save(value, { base: editBase ?? null, key: editKey })
        // Unless they have started typing again in the meantime.
        if (draft() === value) {
            setDraft(null)
            editBase = undefined
            editKey = null
        }
    }

    // The page was reused for another row: the old row gets the words, the new
    // one starts clean.
    if (key) {
        createEffect(key, (next, previous) => {
            if (previous === undefined || next === previous) return
            untrack(() => {
                const value = draft()
                if (value === null || (editKey !== null && same(editKey, next))) return
                const context = { base: editBase ?? null, key: editKey }
                clearTimeout(timer)
                timer = undefined
                setDraft(null)
                editBase = undefined
                editKey = null
                if (!canSave || canSave(value)) void save(value, context).catch(() => {})
            })
        })
    }

    // Leaving the page must not lose the last words. A read of the store here
    // is a one-off, not something to follow.
    // The row may already be gone from under the page (deleted, or the screen
    // is being torn down), and reading it then throws: there is nothing left to
    // save into, so that is not an error worth surfacing.
    const leavePage = () => untrack(() => void flush().catch(() => {}))
    onCleanup(leavePage)

    // Closing or reloading the tab: start the write now; the local database
    // takes it even if the page goes away while it finishes.
    if (typeof window !== 'undefined') {
        const leaving = leavePage
        window.addEventListener('beforeunload', leaving)
        window.addEventListener('pagehide', leaving)
        onCleanup(() => {
            window.removeEventListener('beforeunload', leaving)
            window.removeEventListener('pagehide', leaving)
        })
    }

    return {
        value: () => (current() ? draft()! : saved()),
        /** Typed, not yet saved. */
        dirty: () => current() && draft() !== saved(),
        input(value: string) {
            if (draft() === null || (key && !sameRow(editKey))) {
                editBase = untrack(() => base?.() ?? null)
                editKey = key ? untrack(key) : null
            }
            setDraft(value)
            clearTimeout(timer)
            timer = setTimeout(() => void flush(), delay)
        },
        flush,
        /** Drops the draft without saving it. */
        reset() {
            clearTimeout(timer)
            timer = undefined
            setDraft(null)
            editBase = undefined
            editKey = null
        },
    }
}
