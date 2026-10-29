import { createSignal, For, Show } from 'solid-js'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Toast } from '@/components/ui/Toast'
import { session } from '@/features/auth'

import { describeFailure, type TokenFailure } from '../failures'
import { createToken } from '../tokens'
import './tokens.css'

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

    // The picker is whatever the server says this account can do - never a list
    // of names kept here.
    const scopes = () => session.me?.permissions ?? []
    const blank = () => label().trim() === ''
    const tooLong = () => Array.from(label().trim()).length > 100
    const labelError = () => (tooLong() ? 'Use 100 characters or fewer.' : failure().label)

    function toggle(scope: string, on: boolean) {
        setPicked((prior) => (on ? [...prior, scope] : prior.filter((s) => s !== scope)))
        setFailure((prior) => ({ ...prior, scopes: undefined }))
    }

    async function submit() {
        if (saving() || blank() || tooLong() || picked().length === 0) return
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

    return (
        <Show
            when={secret()}
            fallback={
                <Modal
                    title="Create API token"
                    consequence="A token acts as you, limited to the permissions you choose."
                    confirm="Create token"
                    confirmDisabled={saving() || blank() || tooLong() || picked().length === 0}
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
                        <For each={scopes()}>
                            {(scope) => (
                                <label class="t-body tokens__scope">
                                    <input
                                        type="checkbox"
                                        checked={picked().includes(scope)}
                                        onChange={(event) => toggle(scope, event.currentTarget.checked)}
                                    />{' '}
                                    {scope}
                                </label>
                            )}
                        </For>
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
                    cancel="Close"
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
