import { createEffect } from 'solid-js'

/*
┌─ pageTitle ─────────────────────────────────────
│  the browser tab's title: "<page or item> · LaminarFlow" (LAM-154)
├─ out ───────────────────────────────────────────
│      pageTitle(name)        the title text for a page called `name`; just "LaminarFlow" for none
│      usePageTitle(name)     sets document.title from a reactive name, so a rename, or
│                             a tmp -> real id swap that changes what the lookup finds,
│                             updates the tab
*/
export const APP_NAME = 'LaminarFlow'

export function pageTitle(name?: string | null): string {
    const trimmed = name?.trim()
    return trimmed ? `${trimmed} · ${APP_NAME}` : APP_NAME
}

/** Every route calls this once. `name` is read reactively; undefined (still
 *  loading) shows the bare app name rather than the last page's title. */
export function usePageTitle(name: () => string | null | undefined) {
    createEffect(
        () => pageTitle(name()),
        (title) => {
            document.title = title
        },
    )
}
