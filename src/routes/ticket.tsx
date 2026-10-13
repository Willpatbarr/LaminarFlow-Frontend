import { useParams } from '@solidjs/router'

import { session } from '@/features/auth'
import { TicketDetail } from '@/features/tickets/components/TicketDetail'

import { viewer } from './viewer'

// /tickets/:id. The id goes down as a prop that follows the URL, so moving
// from one ticket to another re-uses the page instead of rebuilding it.
export function TicketPage() {
    const params = useParams<{ id: string }>()
    return <TicketDetail id={params.id} viewer={viewer()} loading={session.status === 'unknown'} />
}
