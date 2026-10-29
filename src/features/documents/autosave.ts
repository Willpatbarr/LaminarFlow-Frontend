import { createSignal, onCleanup, untrack } from 'solid-js'

/*
┌─ documents ─────────────────────────────────────
│  autosave: a field that saves a moment after the typing stops
├─ out ───────────────────────────────────────────
│      createAutosave(saved, save, delay)  → { value, input, flush, dirty }
│      AUTOSAVE_DELAY                      the quiet time before a save, in ms
├─ example ───────────────────────────────────────
│      const body = createAutosave(() => doc.body.content ?? '', (md) => updateDocument(id, { body: { content: md } }))
│      <MarkdownEditor value={body.value()} onChange={body.input} onBlur={body.flush} />
*/
export const AUTOSAVE_DELAY = 800

/** While the user is typing the field shows their draft and ignores the store,
 *  so a sync landing mid-word cannot overwrite it; once the store shows what
 *  was typed the draft is dropped and the field follows the store again. A save
 *  goes to the local store (so never waits on the network) after `delay` ms of
 *  quiet, on `flush` (focus leaving), and when the page is left. */
export function createAutosave(
    saved: () => string,
    save: (value: string) => Promise<unknown>,
    delay: number = AUTOSAVE_DELAY,
) {
    const [draft, setDraft] = createSignal<string | null>(null)
    let timer: ReturnType<typeof setTimeout> | undefined

    async function flush() {
        clearTimeout(timer)
        timer = undefined
        const value = draft()
        if (value === null) return
        if (value !== saved()) await save(value)
        // Unless they have started typing again in the meantime.
        if (draft() === value) setDraft(null)
    }

    // Leaving the page must not lose the last words. A read of the store here
    // is a one-off, not something to follow.
    onCleanup(() => {
        untrack(() => void flush())
    })

    return {
        value: () => draft() ?? saved(),
        /** Typed, not yet saved. */
        dirty: () => draft() !== null && draft() !== saved(),
        input(value: string) {
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
        },
    }
}
