import { Modal } from '@/components/ui/Modal'

import { changes } from './plural'

type LogoutConfirmProps = {
    /** How many changes have not reached the server. */
    unsynced: number
    onConfirm: () => void
    onCancel: () => void
}

// Signing out empties the local database, so changes that never reached the
// server go with it. The confirmation says so in those words, and the safe
// answer (Cancel) is the one focus starts on.
export function LogoutConfirm(props: LogoutConfirmProps) {
    return (
        <Modal
            title="Sign out?"
            consequence={`You have ${changes(props.unsynced)} that ${props.unsynced === 1 ? "hasn't" : "haven't"} synced. Signing out will discard ${props.unsynced === 1 ? 'it' : 'them'}.`}
            confirm="Sign out and discard"
            cancel="Stay signed in"
            destructive
            onConfirm={props.onConfirm}
            onCancel={props.onCancel}
        />
    )
}
