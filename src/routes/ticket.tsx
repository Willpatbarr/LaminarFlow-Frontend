import { useParams } from '@solidjs/router'

import { PageLayout } from '@/components/ui/PageLayout'
import { session } from '@/features/auth'
import { ticketById } from '@/sync'
import { TicketDetail } from '@/features/tickets/components/TicketDetail'

import { viewer } from './viewer'
import { usePageTitle } from './pageTitle'

// /tickets/:id. The id goes down as a prop that follows the URL, so moving
// from one ticket to another re-uses the page instead of rebuilding it.
export function TicketPage() {
    const params = useParams<{ id: string }>()
    usePageTitle(() => {
        const found = ticketById(params.id)
        return found ? found.title.trim() || 'Untitled ticket' : undefined
    })
    return (
        <PageLayout>
            <TicketDetail id={params.id} viewer={viewer()} loading={session.status === 'unknown'} />
        </PageLayout>
    )
}
