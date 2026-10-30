import { useLocation, useNavigate, type RouteSectionProps } from '@solidjs/router'
import { createEffect, createMemo, createSignal, onSettled, Show } from 'solid-js'

import { AppShell } from '@/components/ui/AppShell'
import { ConnectionIndicator } from '@/components/ui/ConnectionIndicator'
import { useNarrowScreen } from '@/components/ui/useNarrowScreen'
import { ICONS, SideNav, type SideNavLink } from '@/components/ui/SideNav'
import { can, logout, RequireAuth, SessionExpiredBanner, SessionUnreachable, session } from '@/features/auth'
import { ThemeSwitch } from '@/features/theme'
import { NewHierarchyDialog } from '@/features/hierarchy/NewHierarchyDialog'
import { filteredProjectId } from '@/features/documents/projectFilter'
import { KINDS, type Kind } from '@/features/hierarchy/kinds'
import { clearMembers } from '@/features/members/members'
import { clearReviewFeed, loadNeedsMine, needsMine, pendingSignature } from '@/features/review/feed'
import { useEditorLinks } from '@/features/links/editorLinks'
import { CommandPalette } from '@/features/search/CommandPalette'
import { hintFor, installShortcutListener, ShortcutHelp, useScope, useShortcut } from '@/features/shortcuts'
import { NewTicketDialog } from '@/features/tickets/components/NewTicketDialog'
import { ReviewRequestedToast } from '@/features/review/ReviewRequestedToast'
import { ArchiveUndoToast } from '@/features/tickets/components/ArchiveUndoToast'
import { CreatedTicketToast } from '@/features/tickets/components/CreatedTicketToast'
import { LogoutConfirm } from '@/features/syncstatus/components/LogoutConfirm'
import { PendingChanges } from '@/features/syncstatus/components/PendingChanges'
import { SyncTroubleToast } from '@/features/syncstatus/components/SyncTroubleToast'
import { boardById, boardsForProject, currentProject, pendingSummary, savedViewsForTeam, statusesForProject, sync, unsyncedCount } from '@/sync'

import { useRekeyRoute } from './rekey'

// Only destinations that exist. Each new screen adds its line here.
const LINKS: SideNavLink[] = [
    { label: 'Tickets', href: '/', icon: ICONS.list },
    { label: 'Epics', href: '/epics', icon: ICONS.epic },
    { label: 'Sprints', href: '/sprints', icon: ICONS.sprint },
    { label: 'Milestones', href: '/milestones', icon: ICONS.milestone },
    { label: 'Documents', href: '/documents', icon: ICONS.document },
    { label: 'Needs my review', href: '/reviews', icon: ICONS.review },
    { label: 'Views', href: '/views', icon: ICONS.views },
    { label: 'API tokens', href: '/settings/tokens', icon: ICONS.key },
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
    // Internal links in every editor below: titles, navigation, the picker.
    useEditorLinks()
    // A temporary id in the address becomes the real one once the engine re-keys it.
    useRekeyRoute()
    // Below 768px the nav is a drawer and the sync status lives in the top bar.
    const narrow = useNarrowScreen()
    const [confirmingLogout, setConfirmingLogout] = createSignal(false)
    // The epic, sprint or milestone being made from the sidebar (LAM-105).
    const [making, setMaking] = createSignal<Kind | null>(null)
    // The ticket being made from the search palette's command (LAM-115).
    const [creatingTicket, setCreatingTicket] = createSignal(false)
    // The keyboard shortcut sheet (`?`, LAM-124).
    const [helping, setHelping] = createSignal(false)
    // The one keydown listener for every shortcut; each screen binds its own keys.
    onSettled(() => installShortcutListener())
    // "Needs my review": asked for once there is an account, and again whenever
    // a review request appears or changes state (they arrive on the change feed).
    createEffect(
        () => ({ me: session.me?.account_id ?? '', changed: pendingSignature(), live: sync.active }),
        ({ me, live }) => {
            if (me && live) void loadNeedsMine(me)
        },
    )
    const HINTS: Record<string, 'nav.tickets' | 'nav.documents'> = { '/': 'nav.tickets', '/documents': 'nav.documents' }
    const links = createMemo(() =>
        LINKS.map((link) => {
            const hint = HINTS[link.href] ? hintFor(HINTS[link.href]) : undefined
            return link.href === '/reviews' && needsMine().length > 0
                ? { ...link, note: String(needsMine().length) }
                : { ...link, hint }
        }),
    )
    // The sync status rows. A 401 means the server answered, so it reads
    // "Signed out", not "Offline"; and while signed out the pending row is left
    // out (the banner says how many changes are waiting), so the rail stays one
    // row shorter exactly when the banner is taking space above.
    const statusRows = () => (
        <>
            <Show when={!session.expired}>
                <PendingChanges />
            </Show>
            <ConnectionIndicator
                state={session.expired ? 'signed_out' : sync.connection}
                syncing={!session.expired && pendingSummary()?.reason === 'waiting' ? pendingSummary()!.count : 0}
            />
        </>
    )
    // The first /auth/me got no usable answer: nothing more to wait for, and
    // the content area says so instead of showing a placeholder for ever.
    const unreachable = () => session.status === 'unknown' && session.loadFailure !== null
    // The first /auth/me is still on its way.
    const stillAsking = () => session.status === 'unknown' && session.loadFailure === null

    // The team in view comes from the URL, so a link to a team, a project or a
    // board always shows the right sidebar: /teams/:id names it, /projects/:id
    // and /boards/:id name a project and so its team, and anywhere else it is
    // the picked project's.
    const activeTeamId = createMemo(() => {
        const path = location.pathname
        const team = /^\/teams\/([^/]+)/.exec(path)
        if (team) return decodeURIComponent(team[1])
        const project = /^\/projects\/([^/]+)/.exec(path)
        const projectId = project ? decodeURIComponent(project[1]) : undefined
        // A board names its project too, so its sidebar is its team's (the saved
        // views listed there are the ones this board's own team shares).
        const board = /^\/boards\/([^/]+)/.exec(path)
        const boardProject = board ? boardById(decodeURIComponent(board[1]))?.project_id : undefined
        const named = projectId ?? boardProject
        const found = named ? sync.projects.find((p) => p.id === named) : currentProject()
        return found?.team_id ?? currentProject()?.team_id ?? sync.teams[0]?.id
    })
    // The project the URL is about (a project page, a board's project, or the /documents filter): where "New document"
    // files a document from the palette. Anywhere else there is no obvious project (team-wide).
    const projectInView = () => {
        const path = location.pathname
        const project = /^\/projects\/([^/]+)/.exec(path)
        if (project) return decodeURIComponent(project[1])
        const board = /^\/boards\/([^/]+)/.exec(path)
        if (board) return boardById(decodeURIComponent(board[1]))?.project_id ?? null
        // /documents filtered to a project: the palette files it there, as the page's own button does (LAM-170).
        if (path === '/documents') {
            const filtered = filteredProjectId(location.search)
            return filtered && sync.projects.some((p) => p.id === filtered) ? filtered : null
        }
        return null
    }
    // Made in the picked project when it is the team in view's, else in the
    // team's first one. Nothing can be made before there is a project.
    const homeProject = () => {
        const picked = currentProject()
        if (picked && picked.team_id === activeTeamId()) return picked
        return sync.projects.filter((p) => p.team_id === activeTeamId()).toSorted((a, b) => a.name.localeCompare(b.name))[0]
    }
    const homeBoard = () => {
        const project = homeProject()
        return project ? boardsForProject(project.id)[0] : undefined
    }
    // Shortcuts that belong to the shell. `C` is the fallback anywhere; the
    // ticket list binds its own, which wins while it is on screen.
    useShortcut('help.open', () => setHelping(true))
    useShortcut('nav.tickets', () => navigate('/'))
    useShortcut('nav.documents', () => navigate('/documents'))
    useShortcut(
        'nav.board',
        () => navigate(`/boards/${homeBoard()!.id}`),
        () => homeBoard() !== undefined,
    )
    // `mod+enter` in the New ticket dialog is handled by the dialog itself; the
    // scope keeps it on the help sheet wherever the app is.
    useScope('global')
    useShortcut(
        'ticket.new',
        () => setCreatingTicket(true),
        () => homeProject() !== undefined,
    )
    // Where the user is, for the top bar on a narrow screen: the nav entry the
    // path is under, else the project or saved view named in it.
    const pageTitle = () => {
        const path = location.pathname
        const link = LINKS.filter((l) => (l.href === '/' ? path === '/' : path === l.href || path.startsWith(`${l.href}/`))).sort(
            (a, b) => b.href.length - a.href.length,
        )[0]
        if (link) return link.label
        const project = /^\/projects\/([^/]+)/.exec(path)
        if (project) return sync.projects.find((p) => p.id === decodeURIComponent(project[1]))?.name ?? 'Project'
        const board = /^\/boards\/([^/]+)/.exec(path)
        if (board) {
            const found = boardById(decodeURIComponent(board[1]))
            const owner = found && sync.projects.find((p) => p.id === found.project_id)
            return owner ? `${owner.name} · Board` : 'Board'
        }
        if (path.startsWith('/tickets/')) return 'Ticket'
        if (path.startsWith('/teams/')) return 'Team'
        return 'LaminarFlow'
    }
    const teams = createMemo(() => sync.teams.toSorted((a, b) => a.name.localeCompare(b.name)))
    const projectLinks = () =>
        sync.projects
            .filter((project) => project.team_id === activeTeamId())
            .toSorted((a, b) => a.name.localeCompare(b.name))
            .map((project) => ({ label: project.name, href: `/projects/${project.id}` }))

    // The team's saved views, one link each. A private one is marked: the server
    // sends a person only their own, so the mark is a reminder, not a filter.
    const viewLinks = () =>
        savedViewsForTeam(activeTeamId() ?? '').map((view) => ({
            label: view.name,
            href: `/views/${view.id}`,
            note: view.is_shared ? undefined : 'Private',
        }))

    // `logout` does not reject: the store is cleared even if the request
    // failed, so landing on /login is unconditional. The guard has already
    // redirected by now, with this page as `returnTo`; going to plain /login
    // is the point of logging out, so that is replaced.
    async function leave() {
        setConfirmingLogout(false)
        await logout()
        clearMembers()
        clearReviewFeed()
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
                title={pageTitle()}
                route={location.pathname}
                status={
                    <Show when={sync.active}>
                        {statusRows()}
                    </Show>
                }
                nav={
                    <SideNav
                        links={links()}
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
                        views={teams().length > 0 ? viewLinks() : undefined}
                        create={
                            homeProject() && can('ticket:write')
                                ? (['epic', 'sprint', 'milestone'] as const).map((kind) => ({
                                      label: `New ${KINDS[kind].singular}`,
                                      icon: ICONS[kind],
                                      onClick: () => setMaking(kind),
                                  }))
                                : undefined
                        }
                        userName={session.me?.display_name}
                        account={<ThemeSwitch />}
                        loading={stillAsking()}
                        status={
                            <Show when={sync.active && !narrow()}>{statusRows()}</Show>
                        }
                        onLogout={askToLeave}
                    />
                }
                banners={
                    <SessionExpiredBanner
                        waiting={unsyncedCount()}
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
                        <CreatedTicketToast />
                        <ReviewRequestedToast />
                    </Show>
                }
            >
                <Show when={unreachable()} fallback={props.children}>
                    <SessionUnreachable />
                </Show>
            </AppShell>
            <CommandPalette
                documentTarget={() => ({ projectId: projectInView() })}
                onNewTicket={homeProject() && can('ticket:write') ? () => setCreatingTicket(true) : undefined}
            />
            <Show when={creatingTicket() && homeProject()}>
                <NewTicketDialog
                    projectId={homeProject()!.id}
                    statuses={statusesForProject(homeProject()!.id)}
                    statusId={statusesForProject(homeProject()!.id)[0]?.id ?? null}
                    onClose={() => setCreatingTicket(false)}
                />
            </Show>
            <Show when={helping()}>
                <ShortcutHelp onClose={() => setHelping(false)} />
            </Show>
            <Show when={making() && homeProject()}>
                <NewHierarchyDialog
                    kind={making()!}
                    projectId={homeProject()!.id}
                    onCreated={(row) => navigate(`${KINDS[making()!].path}/${row.id}`)}
                    onClose={() => setMaking(null)}
                />
            </Show>
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
