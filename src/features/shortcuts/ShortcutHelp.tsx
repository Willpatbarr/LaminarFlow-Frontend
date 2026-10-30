import { For } from 'solid-js'

import { Modal } from '@/components/ui/Modal'

import { listed } from './registry'
import './shortcuts.css'

// The cheat sheet. It draws `listed()`, which is the registry filtered to what
// is bound on this screen and allowed to this account, so it has no list of its
// own to fall out of date.
export function ShortcutHelp(props: { onClose: () => void }) {
    return (
        <Modal title="Keyboard shortcuts" confirm="Close" informational onConfirm={props.onClose} onCancel={props.onClose}>
            <div class="shortcut-help">
                <For each={listed()}>
                    {(group) => (
                        <section class="shortcut-help__group" aria-label={group.heading}>
                            <h3 class="shortcut-help__heading t-meta">{group.heading}</h3>
                            <dl class="shortcut-help__list">
                                <For each={group.items}>
                                    {(item) => (
                                        <div class="shortcut-help__row">
                                            <dt class="t-body">{item.label}</dt>
                                            <dd>
                                                <kbd class="shortcut-help__keys t-meta">{item.keys}</kbd>
                                            </dd>
                                        </div>
                                    )}
                                </For>
                            </dl>
                        </section>
                    )}
                </For>
            </div>
        </Modal>
    )
}
