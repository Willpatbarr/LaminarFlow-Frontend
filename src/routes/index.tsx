import { createFileRoute } from '@tanstack/react-router'

import { TicketList } from '@/features/tickets/components/TicketList'

export const Route = createFileRoute('/')({ component: HomePage })

// Wiring only: choose which feature components this URL shows, and lay them
// out. Logic that grows here belongs in the feature instead.
function HomePage() {
    return <TicketList />
}