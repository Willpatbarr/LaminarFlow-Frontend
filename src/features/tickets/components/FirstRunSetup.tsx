import { createSignal, Show } from 'solid-js'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createProject, createTeam, sync } from '@/sync'

import type { Viewer } from '../viewer'

type FirstRunSetupProps = {
    viewer: Viewer
}

// A new account's workspace has no team and no project, and a ticket needs
// both. This asks for the two names, creates the team, then the project in it.
//
// Both are direct API calls, not queued writes: there is nothing to work on
// offline until they exist. If the team is created and the project then fails,
// the team is already in the store, so trying again only creates the project.
export function FirstRunSetup(props: FirstRunSetupProps) {
    const [teamName, setTeamName] = createSignal('My team')
    const [projectName, setProjectName] = createSignal('First project')
    const [saving, setSaving] = createSignal(false)
    const [failed, setFailed] = createSignal(false)

    const existingTeam = () => sync.teams[0]

    async function submit(event: SubmitEvent) {
        event.preventDefault()
        setSaving(true)
        setFailed(false)
        try {
            const team =
                existingTeam() ?? (await createTeam(props.viewer.workspaceId, teamName().trim()))
            await createProject(team.id, projectName().trim())
        } catch (error) {
            console.error('first-run setup failed', error)
            setFailed(true)
        } finally {
            setSaving(false)
        }
    }

    const ready = () =>
        projectName().trim() !== '' && (existingTeam() !== undefined || teamName().trim() !== '')

    return (
        <form class="tickets__setup" onSubmit={(event) => void submit(event)}>
            <h1 class="t-screen-title">Set up your first team and project</h1>
            <p class="t-body tickets__setup-lede">
                Tickets live in a project, and a project belongs to a team. You can rename both
                later.
            </p>
            <Show
                when={existingTeam()}
                fallback={<Input label="Team name" value={teamName()} onInput={setTeamName} required />}
            >
                {(team) => <p class="t-body">Team: {team().name}</p>}
            </Show>
            <Input label="Project name" value={projectName()} onInput={setProjectName} required />
            <Show when={failed()}>
                <p class="tickets__setup-error t-meta" role="alert">
                    That did not work. Check your connection and try again.
                </p>
            </Show>
            <div>
                <Button type="submit" disabled={saving() || !ready()}>
                    {saving() ? 'Creating…' : 'Create team and project'}
                </Button>
            </div>
        </form>
    )
}
