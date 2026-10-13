import { TicketList } from '@/features/tickets/components/TicketList'

// Wiring only: choose which feature components this URL shows, and lay them
// out. Logic that grows here belongs in the feature instead.
export function HomePage() {
    return <TicketList />
}
