import { createEffect, createMemo, createSignal, Show } from 'solid-js'

import { Toast } from '@/components/ui/Toast'
import { retryNow, syncTrouble, unsyncedCount } from '@/sync'

// One calm message while changes (or the first list) keep failing to reach the
// server. It is derived from the outbox and the engine's status, not raised by
// each failed attempt, so a server that stays down for an hour is one toast
// and not three hundred: the entries retry on their own backoff and the
// message just stays true.
//
// Dismissing hides it for the rest of that spell of trouble. When the server
// is reached again the next failure is news, so the dismissal is forgotten.
// Nothing here is styled as an error: the changes are safe, they are only late.
export function SyncTroubleToast() {
    const trouble = createMemo(syncTrouble)
    const [dismissed, setDismissed] = createSignal(false)

    createEffect(trouble, (now) => {
        if (!now) setDismissed(false)
    })

    return (
        <Show when={trouble() && !dismissed()}>
            <Toast
                hue="amber"
                title={
                    trouble() === 'network'
                        ? "Can't reach the server"
                        : 'Something went wrong on the server'
                }
                detail={
                    unsyncedCount() > 0
                        ? 'Your changes are saved here and will retry.'
                        : 'What you see is saved on this device. We will keep trying.'
                }
                action="Retry now"
                onAction={retryNow}
                onDismiss={() => setDismissed(true)}
            />
        </Show>
    )
}
