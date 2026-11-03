import { createSignal, Show } from 'solid-js'

import { PageSubnav } from '@/components/ui/PageLayout'
import { useShortcut } from '@/features/shortcuts/registry'
import { statusesForProject, type Project, type SavedView } from '@/sync'

import type { ListViewConfig } from '../listView/config'
import { ListHeaderActions } from './ListHeaderActions'
import { NewTicketDialog } from './NewTicketDialog'
import { SavedViewBar } from './SavedViewBar'
import { ViewSwitch } from './ViewSwitch'

/*
┌─ tickets ───────────────────────────────────────
│  ViewHeader: the header the project's list and its board share (LAM-214)
├─ out ───────────────────────────────────────────
│      ViewHeader   <ViewHeader current="list" project={…} boardId={…} config={…} … />
├─ example ───────────────────────────────────────
│      List | Board under the project's name (the page's ProjectFrame draws the name and tabs);
│      Save view, Edit statuses and New ticket (C) at the window's right edge; the
│      "Saved view" bar and its dialog. The same on both screens, at every width.
*/
// Before this the list drew its own actions and the board drew only Save view,
// so the board had no New ticket button (and nothing said `C` works there).
// Both screens now put this in the page header: the title, the tabs and the
// name's Rename come from ProjectFrame (LAM-201), everything else from here.
// New ticket opens the dialog for the project on screen and owns the `C` key.
type ViewHeaderProps = {
    current: 'list' | 'board'
    project: Project
    /** The project's board, for the List | Board switch; without one there is nothing to switch to. */
    boardId?: string
    /** The setup the screen shows now (its filter rides along in the switch). */
    config: ListViewConfig
    /** `view=` from the address. */
    viewId: string | null
    accountId: string
    onSaved: (view: SavedView) => void
    onRevert: (view: SavedView) => void
    /** Run just before the New ticket dialog opens (the list settles its order). */
    onBeforeNew?: () => void
}

export function ViewHeader(props: ViewHeaderProps) {
    const [creating, setCreating] = createSignal(false)
    const [savingView, setSavingView] = createSignal(false)
    const statuses = () => statusesForProject(props.project.id)
    const openDialog = () => {
        props.onBeforeNew?.()
        setCreating(true)
    }
    // Taking over the shell's fallback `C`: the dialog is for this screen's project.
    useShortcut('ticket.new', openDialog)

    return (
        <>
            <Show when={props.boardId}>
                {(boardId) => (
                    <PageSubnav>
                        <ViewSwitch
                            current={props.current}
                            projectId={props.project.id}
                            boardId={boardId()}
                            filter={props.config.filter}
                        />
                    </PageSubnav>
                )}
            </Show>

            <SavedViewBar
                layout={props.current}
                config={props.config}
                viewId={props.viewId}
                accountId={props.accountId}
                teamId={props.project.team_id}
                projectId={props.project.id}
                boardId={props.current === 'board' ? props.boardId : undefined}
                saving={savingView()}
                onSavingChange={setSavingView}
                onSaved={props.onSaved}
                onRevert={props.onRevert}
            />

            <ListHeaderActions teamId={props.project.team_id} onNew={openDialog} onSaveView={() => setSavingView(true)} />

            <Show when={creating()}>
                <NewTicketDialog
                    projectId={props.project.id}
                    statuses={statuses()}
                    statusId={statuses()[0]?.id ?? null}
                    onClose={() => setCreating(false)}
                />
            </Show>
        </>
    )
}
