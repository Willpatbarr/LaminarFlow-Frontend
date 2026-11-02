import { createMemo, For } from 'solid-js'

import { Button } from '@/components/ui/Button'
import { session } from '@/features/auth'
import { ThemeSwitch } from '@/features/theme'
import { currentProject, sync } from '@/sync'

import '@/routes/team-settings.css'
import './settings.css'
import { useLeave } from './leave'

// /settings (LAM-200): every setting in one place, one section each. The pages
// the sections lead to are open to any signed-in account, so nothing here is
// gated differently from them: a section is simply there.
export function SettingsScreen() {
    const leave = useLeave()
    // The team the rest of the app is showing (the picked project's, else the first),
    // listed first.
    const teams = createMemo(() => {
        const active = currentProject()?.team_id ?? sync.teams[0]?.id
        return sync.teams.toSorted(
            (a, b) => Number(b.id === active) - Number(a.id === active) || a.name.localeCompare(b.name),
        )
    })
    return (
        <div class="settings">
            <h1 class="t-screen-title settings__title">Settings</h1>

            <section class="settings__section" aria-labelledby="settings-account">
                <h2 class="t-section" id="settings-account">
                    Account
                </h2>
                <dl class="settings__facts t-body">
                    <dt>Name</dt>
                    <dd>{session.me?.display_name}</dd>
                    <dt>Email</dt>
                    <dd>{session.me?.email}</dd>
                </dl>
                <p class="t-meta">Changing your name, email or password is not available yet.</p>
            </section>

            <section class="settings__section" aria-labelledby="settings-appearance">
                <h2 class="t-section" id="settings-appearance">
                    Appearance
                </h2>
                <ThemeSwitch />
            </section>

            <section class="settings__section" aria-labelledby="settings-teams">
                <h2 class="t-section" id="settings-teams">
                    Teams
                </h2>
                <ul class="settings__teams">
                    <For each={teams()} fallback={<li class="t-meta">This account has no teams yet.</li>}>
                        {(team) => (
                            <li class="settings__team t-body">
                                <span class="settings__team-name">{team.name}</span>
                                <a href={`/teams/${team.id}/settings`} aria-label={`Team settings for ${team.name}`}>
                                    Team settings
                                </a>
                                <a href={`/teams/${team.id}/aspect-types`} aria-label={`Aspect types for ${team.name}`}>
                                    Aspect types
                                </a>
                            </li>
                        )}
                    </For>
                </ul>
            </section>

            <section class="settings__section" aria-labelledby="settings-tokens">
                <h2 class="t-section" id="settings-tokens">
                    API tokens
                </h2>
                <p class="t-meta">Let a script act as you, with only the permissions you give it.</p>
                <p class="t-body">
                    <a href="/settings/tokens">Manage API tokens</a>
                </p>
            </section>

            <section class="settings__section" aria-labelledby="settings-signout">
                <h2 class="t-section" id="settings-signout">
                    Sign out
                </h2>
                <div>
                    <Button variant="secondary" onClick={() => leave()}>
                        Sign out
                    </Button>
                </div>
            </section>
        </div>
    )
}
