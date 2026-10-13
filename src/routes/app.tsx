import { useNavigate, type RouteSectionProps } from '@solidjs/router'
import { Show } from 'solid-js'

import { AppShell } from '@/components/ui/AppShell'
import { SideNav, type SideNavLink } from '@/components/ui/SideNav'
import { logout, RequireAuth, session } from '@/features/auth'
import { SessionPending } from '@/features/auth/components/SessionPending'

// Only destinations that exist. Each new screen adds its line here.
const LINKS: SideNavLink[] = [{ label: 'Tickets', href: '/' }]

// The layout every signed-in route renders inside; login and sign-up are
// outside it. The guard wraps the whole shell so an anonymous user sees none
// of it, and the shell itself renders while the session is still `unknown`
// (with a placeholder in the content area) so the page does not flash blank
// and then rearrange.
export function AppLayout(props: RouteSectionProps) {
    const navigate = useNavigate()

    // `logout` does not reject: the store is cleared even if the request
    // failed, so landing on /login is unconditional. The guard has already
    // redirected by now, with this page as `returnTo`; going to plain /login
    // is the point of logging out, so that is replaced.
    async function leave() {
        await logout()
        navigate('/login', { replace: true })
    }

    return (
        <RequireAuth>
            <AppShell
                nav={
                    <SideNav
                        links={LINKS}
                        userName={session.me?.display_name}
                        onLogout={leave}
                    />
                }
            >
                <Show when={session.status === 'authenticated'} fallback={<SessionPending />}>
                    {props.children}
                </Show>
            </AppShell>
        </RequireAuth>
    )
}
