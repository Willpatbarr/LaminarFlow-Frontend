import { useNavigate, type RouteSectionProps } from '@solidjs/router'
import { createSignal, Show } from 'solid-js'

import { AppShell } from '@/components/ui/AppShell'
import { ConnectionIndicator } from '@/components/ui/ConnectionIndicator'
import { SideNav, type SideNavLink } from '@/components/ui/SideNav'
import { logout, RequireAuth, SessionExpiredBanner, SessionUnreachable, session } from '@/features/auth'
import { SessionPending } from '@/features/auth/components/SessionPending'
import { LogoutConfirm } from '@/features/syncstatus/components/LogoutConfirm'
import { PendingChanges } from '@/features/syncstatus/components/PendingChanges'
import { SyncTroubleToast } from '@/features/syncstatus/components/SyncTroubleToast'
import { sync, unsyncedCount } from '@/sync'

// Only destinations that exist. Each new screen adds its line here.
const LINKS: SideNavLink[] = [{ label: 'Tickets', href: '/' }]

// The layout every signed-in route renders inside; login and sign-up are
// outside it. The guard wraps the whole shell so an anonymous user sees none
// of it, and the shell itself renders while the session is still `unknown`
// (with a placeholder in the content area) so the page does not flash blank
// and then rearrange.
//
// Two kinds of "you are not signed in" meet here, and only one redirects. A
// visitor with no session is `anonymous` and the guard sends them to /login.
// Someone whose session ended while they worked stays `authenticated` with
// `session.expired` set: they keep the page, and the banner asks them to sign
// in where they are.
export function AppLayout(props: RouteSectionProps) {
    const navigate = useNavigate()
    const [confirmingLogout, setConfirmingLogout] = createSignal(false)

    // `logout` does not reject: the store is cleared even if the request
    // failed, so landing on /login is unconditional. The guard has already
    // redirected by now, with this page as `returnTo`; going to plain /login
    // is the point of logging out, so that is replaced.
    async function leave() {
        setConfirmingLogout(false)
        await logout()
        navigate('/login', { replace: true })
    }

    // Logging out empties the local database, so anything not yet on the server
    // would be lost: ask first, but only when there is something to lose.
    function askToLeave() {
        if (unsyncedCount() > 0) setConfirmingLogout(true)
        else void leave()
    }

    return (
        <RequireAuth>
            <AppShell
                nav={
                    <SideNav
                        links={LINKS}
                        userName={session.me?.display_name}
                        status={
                            <Show when={sync.active}>
                                <PendingChanges />
                                <ConnectionIndicator state={sync.connection} />
                            </Show>
                        }
                        onLogout={askToLeave}
                    />
                }
                banners={
                    <SessionExpiredBanner
                        onSignedIn={({ sameAccount }) => {
                            // Someone else's account has none of this
                            // account's tickets: the page they were on is not
                            // theirs to show.
                            if (!sameAccount) navigate('/', { replace: true })
                        }}
                    />
                }
                toasts={
                    <Show when={sync.active}>
                        <SyncTroubleToast />
                    </Show>
                }
            >
                <Show
                    when={session.status === 'authenticated'}
                    fallback={
                        <Show when={session.loadFailure} fallback={<SessionPending />}>
                            <SessionUnreachable />
                        </Show>
                    }
                >
                    {props.children}
                </Show>
            </AppShell>
            <Show when={confirmingLogout()}>
                <LogoutConfirm
                    unsynced={unsyncedCount()}
                    onConfirm={() => void leave()}
                    onCancel={() => setConfirmingLogout(false)}
                />
            </Show>
        </RequireAuth>
    )
}
