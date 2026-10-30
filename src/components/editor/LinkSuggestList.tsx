import { For, Show } from 'solid-js'

import { Popover } from '../ui/Popover'
import type { LinkKind, LinkTarget } from './internalLinks'
import { SHOWN } from './linkSuggest'

/*
┌─ components/editor ─────────────────────────────
│  the list that `@` and `[[` open at the caret (LAM-146)
├─ out ───────────────────────────────────────────
│      LinkSuggestList   <LinkSuggestList id options total active anchor onActive onPick onClose />
│      optionId(id, i)   the id of option i: the editor points aria-activedescendant at it
*/
// A listbox in a Popover, driven from outside: focus never leaves the editor,
// so the editor names the highlighted option with aria-activedescendant and
// MarkdownEditor handles the keys (linkSuggest.keyAction). A pointer press
// picks; pressing does not move focus (Popover keeps it for a listbox).

const KIND: Record<LinkKind, string> = { ticket: 'Ticket', document: 'Document', project: 'Project' }

export const optionId = (id: string, index: number) => `${id}-option-${index}`

type Props = {
    id: string
    options: LinkTarget[]
    /** How many matched before the list was cut to `SHOWN`. */
    total: number
    active: number
    anchor: () => DOMRect | null
    onActive: (index: number) => void
    onPick: (target: LinkTarget) => void
    onClose: () => void
}

export function LinkSuggestList(props: Props) {
    return (
        <Popover
            open
            id={props.id}
            role="listbox"
            label="Link to a ticket, document or project"
            anchor={props.anchor}
            align="start"
            onOpenChange={(open) => {
                if (!open) props.onClose()
            }}
        >
            <Show
                when={props.options.length > 0}
                fallback={
                    <div class="link-suggest__row link-suggest__none t-body" role="option" aria-disabled="true" aria-selected="false" id={optionId(props.id, 0)}>
                        No tickets, documents or projects match
                    </div>
                }
            >
                <For each={props.options} keyed={(target) => `${target.kind}/${target.id}`}>
                    {(target, index) => (
                        <div
                            class="link-suggest__row link-suggest__option t-body"
                            role="option"
                            id={optionId(props.id, index())}
                            aria-selected={index() === props.active ? 'true' : 'false'}
                            data-active={index() === props.active ? 'true' : undefined}
                            onPointerMove={() => index() !== props.active && props.onActive(index())}
                            onClick={() => props.onPick(target())}
                        >
                            <span class="link-suggest__title">{target().title || '(untitled)'}</span>
                            <span class="t-meta link-suggest__kind">{KIND[target().kind]}</span>
                        </div>
                    )}
                </For>
            </Show>
            <Show when={props.total > SHOWN}>
                <div class="link-suggest__foot t-meta" role="presentation">{`Showing ${SHOWN} of ${props.total}. Keep typing to narrow the list.`}</div>
            </Show>
            <div class="link-suggest__foot t-meta" role="presentation" aria-hidden="true">
                <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Enter</kbd> link · <kbd>Esc</kbd> close
            </div>
        </Popover>
    )
}
