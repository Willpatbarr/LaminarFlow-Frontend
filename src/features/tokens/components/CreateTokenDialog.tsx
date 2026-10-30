import { createSignal, For, Show } from 'solid-js'

import { Button } from '@/components/ui/Button'
import { DisclosureCaret } from '@/components/ui/DisclosureCaret'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Toast } from '@/components/ui/Toast'
import { session } from '@/features/auth'

import { describeFailure, type TokenFailure } from '../failures'
import { DANGEROUS_SCOPES, DANGEROUS_WARNING, describeScope, layoutScopes } from '../scopes'
import { createToken } from '../tokens'
import './tokens.css'
import { Checkbox } from '@/components/ui/Checkbox'

/*
┌─ tokens ────────────────────────────────────────
│  CreateTokenDialog: name a token, pick its scopes, then show the secret once
├─ out ───────────────────────────────────────────
│      CreateTokenDialog   <CreateTokenDialog onCreated={…} onClose={…} />
├─ note ──────────────────────────────────────────
│      The secret lives in one signal inside this component. Unmounting the
│      dialog (onClose) drops it; it is never written anywhere else.
*/
type CreateTokenDialogProps = {
    /** A token was made: refresh the list. Called without the secret. */
    onCreated: () => void
    onClose: () => void
}

export function CreateTokenDialog(props: CreateTokenDialogProps) {
    const [label, setLabel] = createSignal('')
    const [picked, setPicked] = createSignal<string[]>([])
    const [saving, setSaving] = createSignal(false)
    const [failure, setFailure] = createSignal<TokenFailure>({})
    const [secret, setSecret] = createSignal<string | null>(null)
    const [copied, setCopied] = createSignal(false)
    const [dangerOpen, setDangerOpen] = createSignal(false)
    const [understood, setUnderstood] = createSignal(false)

    // The picker is whatever the server says this account can do - never a list
    // of names kept here.
    const layout = () => layoutScopes(session.me?.permissions ?? [])
    const dangerPicked = () => picked().some((s) => DANGEROUS_SCOPES.includes(s))
    // A dangerous scope needs its own yes, on top of the tick.
    const ready = () => !blank() && !tooLong() && picked().length > 0 && (!dangerPicked() || understood())
    const blank = () => label().trim() === ''
    const tooLong = () => Array.from(label().trim()).length > 100
    const labelError = () => (tooLong() ? 'Use 100 characters or fewer.' : failure().label)

    function toggle(scope: string, on: boolean) {
        setPicked((prior) => (on ? [...prior, scope] : prior.filter((s) => s !== scope)))
        if (DANGEROUS_SCOPES.includes(scope)) {
            setUnderstood(false)
            if (on) setDangerOpen(true)
        }
        setFailure((prior) => ({ ...prior, scopes: undefined }))
    }

    async function submit() {
        if (saving() || !ready()) return
        setSaving(true)
        setFailure({})
        try {
            const created = await createToken(label().trim(), picked())
            setSecret(created.token)
            props.onCreated()
        } catch (error) {
            setFailure(describeFailure(error))
        } finally {
            setSaving(false)
        }
    }

    async function copy() {
        const value = secret()
        if (value === null) return
        try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
        } catch {
            // Clipboard refused: the field is selectable, so say so.
            setFailure({ form: 'Could not copy. Select the token and copy it by hand.' })
        }
    }

    // One checkbox: the plain-English action, what it allows, the code in small
    // monospace. The accessible name leads with the visible words and ends with
    // the code, which is what an API user looks for.
    function scopeBox(scope: () => string, area: () => string, action: () => string) {
        const name = () => [area(), action()].filter(Boolean).join(' ')
        return (
            <label class="tokens__scope">
                <Checkbox
                    aria-label={name() && name() !== scope() ? `${name()} (${scope()})` : scope()}
                    checked={picked().includes(scope())}
                    onChange={(event) => toggle(scope(), event.currentTarget.checked)}
                />
                <span class="tokens__scope-text">
                    <span class="t-body">{action() || area()}</span>
                    <span class="t-meta tokens__scope-desc">{describeScope(scope()) ?? 'No description yet.'}</span>
                    <code class="tokens__code">{scope()}</code>
                </span>
            </label>
        )
    }

    return (
        <Show
            when={secret()}
            fallback={
                <Modal
                    title="Create API token"
                    consequence="A token acts as you, limited to the permissions you choose."
                    confirm="Create token"
                    confirmDisabled={saving() || !ready()}
                    wide
                    onConfirm={() => void submit()}
                    onCancel={props.onClose}
                >
                    <Input
                        label="Name"
                        value={label()}
                        onInput={(value) => {
                            setLabel(value)
                            setFailure((prior) => ({ ...prior, label: undefined }))
                        }}
                        error={labelError()}
                    />
                    <fieldset class="tokens__scopes">
                        <legend class="t-body">Permissions</legend>
                        <For each={layout().groups} keyed={(row) => row.group.id}>
                            {(row) => (
                                <div class="tokens__group">
                                    <p class="t-body tokens__group-title">{row().group.title}</p>
                                    <div class="tokens__pair">
                                        <Show when={row().read}>{(scope) => scopeBox(scope, () => row().group.title, () => 'Read')}</Show>
                                        <Show when={row().write}>{(scope) => scopeBox(scope, () => row().group.title, () => 'Write')}</Show>
                                    </div>
                                </div>
                            )}
                        </For>
                        <For each={layout().other} keyed={(scope) => scope}>
                            {(scope) => <div class="tokens__group">{scopeBox(scope, () => '', scope)}</div>}
                        </For>
                        <Show when={layout().dangerous.length > 0}>
                            <details
                                class="tokens__danger"
                                open={dangerOpen()}
                                onToggle={(event) => setDangerOpen(event.currentTarget.open)}
                            >
                                <summary class="t-body disclosure-summary">
                                    <DisclosureCaret />
                                    Dangerous permissions
                                    <Show when={dangerPicked()}>
                                        <span class="t-meta"> (1 chosen)</span>
                                    </Show>
                                </summary>
                                <p class="t-meta tokens__warning">{DANGEROUS_WARNING}</p>
                                <For each={layout().dangerous} keyed={(scope) => scope}>
                                    {(scope) => scopeBox(scope, () => 'Delete account', () => '')}
                                </For>
                                <Show when={dangerPicked()}>
                                    <label class="t-body tokens__confirm" for="token-understood">
                                        <Checkbox
                                            id="token-understood"
                                            checked={understood()}
                                            onChange={(event) => setUnderstood(event.currentTarget.checked)}
                                        />
                                        <span>I understand this token could delete my account.</span>
                                    </label>
                                </Show>
                            </details>
                        </Show>
                        <Show when={failure().scopes}>
                            {(message) => (
                                <p class="t-meta tokens__error" role="alert">
                                    {message()}
                                </p>
                            )}
                        </Show>
                    </fieldset>
                    <Show when={failure().form}>
                        {(message) => (
                            <p class="t-meta tokens__error" role="alert">
                                {message()}
                            </p>
                        )}
                    </Show>
                </Modal>
            }
        >
            {(token) => (
                <Modal
                    title="Copy your token"
                    consequence="You won't see this again."
                    confirm="Done"
                    persistent
                    onConfirm={props.onClose}
                    onCancel={props.onClose}
                >
                    <Input label="Token" value={token()} onInput={() => {}} readOnly />
                    <div class="tokens__copy">
                        <Button variant="secondary" onClick={() => void copy()}>
                            Copy token
                        </Button>
                    </div>
                    <Show when={copied()}>
                        <Toast title="Copied" detail="The token is on your clipboard." onDismiss={() => setCopied(false)} />
                    </Show>
                    <Show when={failure().form}>
                        {(message) => (
                            <p class="t-meta tokens__error" role="alert">
                                {message()}
                            </p>
                        )}
                    </Show>
                </Modal>
            )}
        </Show>
    )
}
