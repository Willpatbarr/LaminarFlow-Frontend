import { useNavigate, useParams } from '@solidjs/router'
import { Show } from 'solid-js'

import { AspectTypeEditor } from '@/features/aspects/components/AspectTypeEditor'
import { AspectTypeList } from '@/features/aspects/components/AspectTypeList'
import { session } from '@/features/auth'
import { isLoading, sync } from '@/sync'
import { usePageTitle } from './pageTitle'

// /teams/:teamId/aspect-types and /teams/:teamId/aspect-types/:id (LAM-98). Which
// teams exist comes from the local store; the aspect types themselves are asked
// of the server, since they are not a sync entity.
function useTeam() {
    const params = useParams<{ teamId: string; id?: string }>()
    const team = () => sync.teams.find((candidate) => candidate.id === params.teamId)
    const busy = () => session.status === 'unknown' || isLoading()
    usePageTitle(() => (team() ? `${params.id ? 'Edit aspect type' : 'Aspect types'} · ${team()!.name}` : undefined))
    return { params, team, busy }
}

function NoTeam() {
    return (
        <>
            <h1 class="t-screen-title">Team not found</h1>
            <p class="t-body">
                This account has no such team. <a href="/">Back to tickets</a>
            </p>
        </>
    )
}

export function AspectTypesPage() {
    const { team, busy } = useTeam()
    const navigate = useNavigate()
    return (
        <section aria-busy={busy() ? 'true' : undefined}>
            <Show when={!busy()} fallback={<p class="visually-hidden" role="status">Loading aspect types…</p>}>
                <Show when={team()} fallback={<NoTeam />}>
                    {(found) => (
                        <>
                            <p class="t-body">
                                <a href={`/teams/${found().id}/settings`}>← Team settings</a>
                            </p>
                            <h1 class="t-screen-title">Aspect types</h1>
                            <p class="t-meta">
                                The labeled fields a document of that type has. Starter types are yours to rename, change or delete.
                            </p>
                            <AspectTypeList
                                teamId={found().id}
                                onOpen={(id) => navigate(`/teams/${found().id}/aspect-types/${id}`)}
                            />
                        </>
                    )}
                </Show>
            </Show>
        </section>
    )
}

export function AspectTypePage() {
    const { params, team, busy } = useTeam()
    return (
        <section aria-busy={busy() ? 'true' : undefined}>
            <Show when={!busy()} fallback={<p class="visually-hidden" role="status">Loading aspect type…</p>}>
                <Show when={team()} fallback={<NoTeam />}>
                    {(found) => (
                        <>
                            <p class="t-body">
                                <a href={`/teams/${found().id}/aspect-types`}>← Aspect types</a>
                            </p>
                            <h1 class="t-screen-title">Edit aspect type</h1>
                            <AspectTypeEditor typeId={params.id!} />
                        </>
                    )}
                </Show>
            </Show>
        </section>
    )
}
