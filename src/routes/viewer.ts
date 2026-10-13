import { session } from '@/features/auth'
import type { Viewer } from '@/features/tickets/viewer'

// The signed-in account in the shape the ticket screens take it. Built here
// because routes are where two features may meet: tickets does not import
// auth. Every route under AppLayout renders only while authenticated; the
// fallbacks cover the instant between logout and the redirect.
export function viewer(): Viewer {
    return {
        accountId: session.me?.account_id ?? '',
        workspaceId: session.me?.workspace_id ?? '',
        displayName: session.me?.display_name ?? '',
    }
}
