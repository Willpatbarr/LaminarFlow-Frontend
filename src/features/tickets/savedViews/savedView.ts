import type { SavedView, SavedViewConfig } from '@/sync'

import { fromSearch, normalize, toSearch, type FilterGroup, type ListViewConfig } from '../listView/config'

/*
┌─ tickets/savedViews ────────────────────────────
│  saved views <-> the list and board URLs (LAM-118)
├─ out ───────────────────────────────────────────
│      VIEW_PARAM, configOf, toSavedConfig, boardSearch, viewUrl, isChanged
├─ example ───────────────────────────────────────
│      viewUrl(listView)   →  /?filter={…}&group=epic&view=<id>
│      viewUrl(boardView)  →  /boards/<board_id>?filter={…}&view=<id>
*/
// A saved view's `config` is the list's `ListViewConfig` and nothing else
// (listView/config.ts), so saving is a copy and opening is the URL that config
// already makes. `view=<id>` rides along in the address to say which saved view
// the screen came from; it is how the screen knows to compare itself with it.
//
// A board has its columns on the board itself (LAM-107), so a board view keeps
// only the part of the config a board uses: its `filter`.

export const VIEW_PARAM = 'view'

/** The list-shaped config a saved view holds, run through the URL codec: what
 *  the screen would make of it. Anything that could not be shown (a field this
 *  client does not know) is dropped, on both sides of every comparison. */
export function configOf(view: Pick<SavedView, 'config' | 'layout'>): ListViewConfig {
    const raw: ListViewConfig = {
        filter: view.config.filter,
        group: view.config.group,
        sort: view.config.sort ?? undefined,
        columns: view.config.columns ?? undefined,
    }
    const { config } = fromSearch(toSearch(view.layout === 'board' ? { filter: raw.filter } : raw))
    return view.layout === 'board' ? normalize({ filter: config.filter }) : normalize(config)
}

/** What is stored for a screen's current setup. */
export function toSavedConfig(config: ListViewConfig, layout: SavedView['layout']): SavedViewConfig {
    return layout === 'board' ? normalize({ filter: config.filter }) : normalize(config)
}

/** The query of a board address: the filter, and the saved view it came from. */
export function boardSearch(filter: FilterGroup | undefined, viewId?: string | null): URLSearchParams {
    const params = toSearch({ filter })
    params.delete('group')
    if (viewId) params.set(VIEW_PARAM, viewId)
    return params
}

/** Where opening this saved view goes. */
export function viewUrl(view: Pick<SavedView, 'id' | 'layout' | 'board_id' | 'config'>): string {
    const config = configOf(view)
    if (view.layout === 'board' && view.board_id) {
        return `/boards/${encodeURIComponent(view.board_id)}?${boardSearch(config.filter, view.id)}`
    }
    const params = toSearch(config)
    params.set(VIEW_PARAM, view.id)
    return `/?${params}`
}

/** Whether `current` differs from what the view saved. Both are compared as
 *  the URL writes them, which puts the keys of a filter in one fixed order
 *  (the server's jsonb does not keep the order they were saved in). */
export function isChanged(view: Pick<SavedView, 'config' | 'layout'>, current: ListViewConfig): boolean {
    const key = (config: ListViewConfig) => toSearch(view.layout === 'board' ? { filter: config.filter } : config).toString()
    return key(configOf(view)) !== key(current)
}
