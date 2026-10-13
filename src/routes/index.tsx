import { TicketList } from '@/features/tickets/components/TicketList'

import { viewer } from './viewer'

// Wiring only: choose which feature components this URL shows, and lay them
// out. Logic that grows here belongs in the feature instead.
export function HomePage() {
    return <TicketList viewer={viewer()} />
}
