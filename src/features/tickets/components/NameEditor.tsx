import { createSignal, Show } from 'solid-js'

import { classify } from '@/api/errors'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { denial } from '@/features/auth'
import { renameProject, renameTeam } from '@/sync'

import { nameCount, overMessage } from '../limits'

/*
┌─ tickets/components ────────────────────────────
│  renaming a team or a project (LAM-149)
├─ out ───────────────────────────────────────────
│      TeamNameField       a name field with Save, for team settings
│      ProjectNameHeading  the project's name as a heading, with a Rename button
*/
// Both are direct calls, not queued writes (teams and projects are read-only context to the
// sync engine), so the form is the only place a failure can be said. On success the store
// shows the new name everywhere: the sidebar, the team switcher and the page titles all read it.

const BLANK = (noun: string) => `A ${noun} needs a name.`

type Noun = 'team' | 'project'

function describeFailure(error: unknown, noun: Noun): string {
    if ((error as { code?: unknown } | null)?.code === 'team_name_taken') {
        return 'Another team in this workspace already has that name. Choose a different one.'
    }
    switch (classify(error)) {
        case 'network':
            return "Can't reach the server. Check your connection and try again."
        case 'unauthorized':
            return "You've been signed out. Sign in from the banner above, then try again."
        case 'validation':
            return `The server didn't accept that ${noun} name. Check it and try again.`
        case 'forbidden':
            return `You don't have permission to rename this ${noun}.`
        case 'not_found':
            return `This ${noun} no longer exists.`
        default:
            return 'That did not work. The server had a problem; try again in a moment.'
    }
}

// The state shared by both: the draft, the refusal shown under it, and what the last save did.
function createRename(noun: Noun, current: () => string, save: (name: string) => Promise<void>) {
    const [draft, setDraft] = createSignal<string | null>(null)
    const [error, setError] = createSignal<string | undefined>()
    const [state, setState] = createSignal<'idle' | 'saving' | 'saved' | 'failed'>('idle')

    const value = () => draft() ?? current()
    const over = () => overMessage(`${noun === 'team' ? 'Team' : 'Project'} name`, nameCount(value()))
    const dirty = () => value().trim() !== current()

    async function submit(): Promise<boolean> {
        const name = value().trim()
        if (name === '') {
            setError(BLANK(noun))
            setState('idle')
            return false
        }
        if (over()) return false
        if (name === current()) {
            setDraft(null)
            return true
        }
        setState('saving')
        setError(undefined)
        try {
            await save(name)
            setDraft(null)
            setState('saved')
            return true
        } catch (failure) {
            console.error(`renaming the ${noun} failed`, failure)
            setError(describeFailure(failure, noun))
            setState('failed')
            return false
        }
    }

    return {
        value,
        setValue(next: string) {
            setDraft(next)
            setError(undefined)
            setState('idle')
        },
        reset() {
            setDraft(null)
            setError(undefined)
            setState('idle')
        },
        error: () => error() ?? over(),
        state,
        dirty,
        submit,
    }
}

export function TeamNameField(props: { teamId: string; name: string }) {
    const rename = createRename('team', () => props.name, (name) => renameTeam(props.teamId, name))
    return (
        <form
            class="name-editor"
            onSubmit={(event) => {
                event.preventDefault()
                void rename.submit()
            }}
        >
            <Input
                label="Team name"
                value={rename.value()}
                onInput={rename.setValue}
                count={nameCount(rename.value())}
                error={rename.error()}
            />
            <Button
                type="submit"
                disabled={rename.state() === 'saving' || !rename.dirty()}
                disabledReason={denial('team:write', 'rename teams')}
            >
                {rename.state() === 'saving' ? 'Saving…' : 'Save name'}
            </Button>
            <p class="t-meta" role="status">
                {rename.state() === 'saved' ? 'Saved.' : rename.state() === 'failed' ? 'Not saved.' : ''}
            </p>
        </form>
    )
}

export function ProjectNameHeading(props: { projectId: string; name: string }) {
    const [editing, setEditing] = createSignal(false)
    const rename = createRename('project', () => props.name, (name) => renameProject(props.projectId, name))

    const stop = () => {
        rename.reset()
        setEditing(false)
    }

    return (
        <Show
            when={editing()}
            fallback={
                <div class="name-editor">
                    <h1 class="t-screen-title">{props.name}</h1>
                    <Button
                        variant="ghost"
                        aria-label="Rename project"
                        disabledReason={denial('project:write', 'rename projects')}
                        onClick={() => setEditing(true)}
                    >
                        Rename
                    </Button>
                </div>
            }
        >
            <form
                class="name-editor"
                onSubmit={(event) => {
                    event.preventDefault()
                    void rename.submit().then((saved) => saved && setEditing(false))
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') stop()
                }}
            >
                <Input
                    label="Project name"
                    value={rename.value()}
                    onInput={rename.setValue}
                    count={nameCount(rename.value())}
                    error={rename.error()}
                    ref={(el) => queueMicrotask(() => el.focus())}
                />
                <Button type="submit" disabled={rename.state() === 'saving'}>
                    {rename.state() === 'saving' ? 'Saving…' : 'Save name'}
                </Button>
                <Button variant="ghost" onClick={stop}>
                    Cancel (Esc)
                </Button>
            </form>
        </Show>
    )
}
