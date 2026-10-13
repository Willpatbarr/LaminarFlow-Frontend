import { session } from '@/features/auth'
import { TicketList } from '@/features/tickets/components/TicketList'

import { viewer } from './viewer'

// Wiring only: choose which feature components this URL shows, and lay them
// out. Logic that grows here belongs in the feature instead.
//
// While the session is `unknown` the layout renders its children (see
// AppLayout), so each page says for itself that it is waiting: the list draws
// its own placeholder rather than the layout guessing which page this is.
export function HomePage() {
    return <TicketList viewer={viewer()} loading={session.status === 'unknown'} />
}
