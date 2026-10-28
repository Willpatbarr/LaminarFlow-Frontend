import { useLocation, useNavigate, type RouteSectionProps } from '@solidjs/router'
import { createMemo, createSignal, Show } from 'solid-js'

import { AppShell } from '@/components/ui/AppShell'
import { ConnectionIndicator } from '@/components/ui/ConnectionIndicator'
import { ICONS, SideNav, type SideNavLink } from '@/components/ui/SideNav'
import { logout, RequireAuth, SessionExpiredBanner, SessionUnreachable, session } from '@/features/auth'
import { ArchiveUndoToast } from '@/features/tickets/components/ArchiveUndoToast'
import { LogoutConfirm } from '@/features/syncstatus/components/LogoutConfirm'
import { PendingChanges } from '@/features/syncstatus/components/PendingChanges'
import { SyncTroubleToast } from '@/features/syncstatus/components/SyncTroubleToast'
import { currentProject, sync, unsyncedCount } from '@/sync'

// Only destinations that exist. Each new screen adds its line here.
const LINKS: SideNavLink[] = [
    { label: 'Tickets', href: '/', icon: ICONS.list },
    { label: 'Documents', href: '/documents', icon: ICONS.document },
    { label: 'Views', href: '/views', icon: ICONS.views },
]

// The layout every signed-in route renders inside; login and sign-up are
// outside it. The guard wraps the whole shell so an anonymous user sees none
// of it, and the shell itself renders while the session is still `unknown`:
// the rail in its loading state, and the routed page (which sees the same
// session and draws its own loading state) in the content area, so the page
// does not flash blank and then rearrange.
//
// Two kinds of "you are not signed in" meet here, and only one redirects. A
// visitor with no session is `anonymous` and the guard sends them to /login.
// Someone whose session ended while they worked stays `authenticated` with
// `session.expired` set: they keep the page, and the banner asks them to sign
// in where they are.
export function AppLayout(props: RouteSectionProps) {
    const navigate = useNavigate()
    const location = useLocation()
    const [confirmingLogout, setConfirmingLogout] = createSignal(false)
    // The first /auth/me got no usable answer: nothing more to wait for, and
    // the content area says so instead of showing a placeholder for ever.
    const unreachable = () => session.status === 'unknown' && session.loadFailure !== null
    // The first /auth/me is still on its way.
    const stillAsking = () => session.status === 'unknown' && session.loadFailure === null

    // The team in view comes from the URL, so a link to a team or a project
    // always shows the right sidebar: /teams/:id names it, /projects/:id names
    // a project and so its team, and anywhere else it is the picked project's.
    const activeTeamId = createMemo(() => {
        const path = location.pathname
        const team = /^\/teams\/([^/]+)/.exec(path)
        if (team) return decodeURIComponent(team[1])
        const project = /^\/projects\/([^/]+)/.exec(path)
        const projectId = project ? decodeURIComponent(project[1]) : undefined
        const found = projectId ? sync.projects.find((p) => p.id === projectId) : currentProject()
        return found?.team_id ?? currentProject()?.team_id ?? sync.teams[0]?.id
    })
    const teams = createMemo(() => sync.teams.toSorted((a, b) => a.name.localeCompare(b.name)))
    const projectLinks = () =>
        sync.projects
            .filter((project) => project.team_id === activeTeamId())
            .toSorted((a, b) => a.name.localeCompare(b.name))
            .map((project) => ({ label: project.name, href: `/projects/${project.id}` }))

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
                        teams={
                            teams().length > 0 && activeTeamId()
                                ? {
                                      options: teams().map((t) => ({ value: t.id, label: t.name })),
                                      value: activeTeamId()!,
                                      onChange: (id) => navigate(`/teams/${id}`),
                                  }
                                : undefined
                        }
                        projects={teams().length > 0 ? projectLinks() : undefined}
                        userName={session.me?.display_name}
                        loading={stillAsking()}
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
                        <ArchiveUndoToast />
                    </Show>
                }
            >
                <Show when={unreachable()} fallback={props.children}>
                    <SessionUnreachable />
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
