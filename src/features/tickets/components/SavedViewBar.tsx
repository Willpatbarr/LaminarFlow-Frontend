import { createSignal, Show } from 'solid-js'

import { Banner } from '@/components/ui/Banner'
import { can, denial } from '@/features/auth'
import { Button } from '@/components/ui/Button'
import { canEditSavedView, createSavedView, savedViewById, updateSavedView, type SavedView } from '@/sync'

import type { ListViewConfig } from '../listView/config'
import { isChanged, toSavedConfig } from '../savedViews/savedView'
import { SaveViewDialog } from './SaveViewDialog'
import './tickets.css'

/*
┌─ tickets ───────────────────────────────────────
│  SavedViewBar: "Save view", and the saved view this screen came from (LAM-118)
├─ out ───────────────────────────────────────────
│      SavedViewBar   <SavedViewBar layout={…} config={…} viewId={…} … />
├─ example ───────────────────────────────────────
│      opened from the sidebar, then a filter added  →  "“Bugs” has changed."  [Save changes] [Revert]
*/
// A controlled bar: the list and the board each own where their setup lives (the
// address), and tell this the setup they show now. It owns nothing but the
// dialog. The view it compares against is the one named by `view=` in the
// address, if it is a view of this kind of screen and still exists.
type SavedViewBarProps = {
    layout: SavedView['layout']
    /** The setup the screen shows now. */
    config: ListViewConfig
    /** `view=` from the address. */
    viewId: string | null
    accountId: string
    teamId: string
    projectId: string
    /** The board on screen; set exactly for `layout: board`. */
    boardId?: string
    /** A new view was saved: the screen now belongs to it. */
    onSaved: (view: SavedView) => void
    /** Put the screen back to what the view saved. */
    onRevert: (view: SavedView) => void
}

export function SavedViewBar(props: SavedViewBarProps) {
    const [saving, setSaving] = createSignal(false)

    // A view of the other kind of screen (or another board) is not this
    // screen's to compare with.
    const view = () => {
        const found = props.viewId ? savedViewById(props.viewId) : undefined
        if (!found || found.layout !== props.layout) return undefined
        return found.layout === 'board' && found.board_id !== props.boardId ? undefined : found
    }
    const changed = () => {
        const found = view()
        return found !== undefined && isChanged(found, props.config)
    }

    async function save(input: { name: string; is_shared: boolean }) {
        setSaving(false)
        const created = await createSavedView({
            team_id: props.teamId,
            project_id: props.projectId,
            board_id: props.layout === 'board' ? (props.boardId ?? null) : null,
            layout: props.layout,
            name: input.name,
            is_shared: input.is_shared,
            config: toSavedConfig(props.config, props.layout),
        })
        props.onSaved(created)
    }

    return (
        <div class="saved-view-bar">
            <div class="saved-view-bar__row">
                <Show when={view()}>
                    {(found) => (
                        <p class="saved-view-bar__name t-meta">
                            Saved view: <strong>{found().name}</strong> ({found().is_shared ? 'team' : 'private'})
                        </p>
                    )}
                </Show>
                <Button
                    variant="secondary"
                    disabledReason={denial('ticket:write', 'save views')}
                    onClick={() => setSaving(true)}
                >
                    Save view
                </Button>
            </div>
            <Show when={changed() ? view() : undefined}>
                {(found) => (
                    <Banner role="status">
                        <span>“{found().name}” has changed.</span>{' '}
                        <Show when={can('ticket:write') && canEditSavedView(found(), props.accountId)}>
                            <button
                                type="button"
                                class="saved-view-bar__link"
                                onClick={() =>
                                    void updateSavedView(found().id, { config: toSavedConfig(props.config, props.layout) })
                                }
                            >
                                Save changes
                            </button>{' '}
                        </Show>
                        <button type="button" class="saved-view-bar__link" onClick={() => props.onRevert(found())}>
                            Revert
                        </button>
                    </Banner>
                )}
            </Show>
            <Show when={saving()}>
                <SaveViewDialog layout={props.layout} onSave={(input) => void save(input)} onCancel={() => setSaving(false)} />
            </Show>
        </div>
    )
}
