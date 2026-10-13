import { session } from '@/features/auth'
import type { Viewer } from '@/features/tickets/viewer'

// The signed-in account in the shape the ticket screens take it. Built here
// because routes are where two features may meet: tickets does not import
// auth. Routes under AppLayout render while authenticated, and while the
// session is still `unknown` (as placeholders, which show none of this); the
// fallbacks cover both that and the instant between logout and the redirect.
export function viewer(): Viewer {
    return {
        accountId: session.me?.account_id ?? '',
        workspaceId: session.me?.workspace_id ?? '',
        displayName: session.me?.display_name ?? '',
    }
}
