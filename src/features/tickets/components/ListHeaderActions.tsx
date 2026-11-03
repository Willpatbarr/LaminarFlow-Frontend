import { Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'

import { denial } from '@/features/auth'
import { ShortcutHint } from '@/features/shortcuts/ShortcutHint'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/icons/Icon'
import { PageActions } from '@/components/ui/PageLayout'
import { RowMenu, RowMenuItem } from '@/components/ui/RowMenu'
import { Tooltip } from '@/components/ui/Tooltip'
import { useNarrowScreen } from '@/components/ui/useNarrowScreen'

/*
┌─ tickets ───────────────────────────────────────
│  ListHeaderActions: the buttons at the right end of the tickets header (LAM-212)
├─ out ───────────────────────────────────────────
│      ListHeaderActions   <ListHeaderActions teamId={…} onNew={…} onSaveView={…} />
├─ example ───────────────────────────────────────
│      desktop and tablet: Save view, Edit statuses, New ticket (as before)
│      phone: a New ticket icon button, then a ⋯ menu holding Save view and Edit statuses
*/
// One place for the header's actions, so the board can use the same component
// when the two screens share a header (LAM-214). It draws into the page
// header's actions slot. Every action stays one tap away on a phone: the two
// quiet ones fold into the ⋯ menu, the main one stays a button.
type ListHeaderActionsProps = {
    teamId?: string
    onNew?: () => void
    onSaveView?: () => void
    /** The placeholder while tickets load: only New ticket, disabled, so it
     *  does not appear a moment later and nothing moves when the data arrives. */
    loading?: boolean
}

export function ListHeaderActions(props: ListHeaderActionsProps) {
    // Split so the loading placeholder (which can render with no router around it) never asks for one.
    return (
        <Show
            when={props.loading}
            fallback={<LiveActions teamId={props.teamId} onNew={props.onNew} onSaveView={props.onSaveView} />}
        >
            <LoadingActions />
        </Show>
    )
}

function LoadingActions() {
    const narrow = useNarrowScreen()
    return (
        <PageActions>
            <Show
                when={narrow()}
                fallback={
                    <Button disabled>
                        <Icon name="new-ticket" size={16} />
                        New ticket
                    </Button>
                }
            >
                <button type="button" class="button button--primary list-header__new" aria-label="New ticket" disabled>
                    <Icon name="plus" size={20} />
                </button>
            </Show>
        </PageActions>
    )
}

function LiveActions(props: Omit<ListHeaderActionsProps, 'loading'>) {
    const narrow = useNarrowScreen()
    const navigate = useNavigate()
    const settings = () => `/teams/${props.teamId ?? ''}/settings`
    const newDenied = () => denial('ticket:write', 'create tickets')
    const saveDenied = () => denial('ticket:write', 'save views')
    return (
        <PageActions>
            <Show
                when={narrow()}
                fallback={
                    <>
                        <Button variant="secondary" disabledReason={saveDenied()} onClick={() => props.onSaveView?.()}>
                            Save view
                        </Button>
                        <a class="button button--ghost" href={settings()}>
                            Edit statuses
                        </a>
                        <Button onClick={() => props.onNew?.()} disabledReason={newDenied()}>
                            <Icon name="new-ticket" size={16} />
                            New ticket
                            <ShortcutHint id="ticket.new" />
                        </Button>
                    </>
                }
            >
                <RowMenu label="More actions">
                    <RowMenuItem onSelect={() => props.onSaveView?.()} disabledReason={saveDenied()}>
                        Save view
                    </RowMenuItem>
                    <RowMenuItem onSelect={() => navigate(settings())}>Edit statuses</RowMenuItem>
                </RowMenu>
                <Show
                    when={newDenied()}
                    fallback={
                        <button
                            type="button"
                            class="button button--primary list-header__new"
                            aria-label="New ticket"
                            onClick={() => props.onNew?.()}
                        >
                            <Icon name="plus" size={20} />
                        </button>
                    }
                >
                    {(reason) => (
                        <Tooltip text={reason()}>
                            {(describedBy) => (
                                <button
                                    type="button"
                                    class="button button--primary list-header__new"
                                    aria-label="New ticket"
                                    aria-describedby={describedBy}
                                    disabled
                                >
                                    <Icon name="plus" size={20} />
                                </button>
                            )}
                        </Tooltip>
                    )}
                </Show>
            </Show>
        </PageActions>
    )
}
