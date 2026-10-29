import { createSignal, For, onSettled, Show } from 'solid-js'

import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

import { describeFailure } from '../failures'
import { listTokens, revokeToken, type Token } from '../tokens'
import { CreateTokenDialog } from './CreateTokenDialog'
import './tokens.css'

/*
┌─ tokens ────────────────────────────────────────
│  TokensScreen: the account's active API tokens, with create and revoke (LAM-101)
├─ out ───────────────────────────────────────────
│      TokensScreen   <TokensScreen />
*/
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })

export function TokensScreen() {
    const [tokens, setTokens] = createSignal<Token[] | null>(null)
    const [loadFailure, setLoadFailure] = createSignal<string | null>(null)
    const [creating, setCreating] = createSignal(false)
    const [revoking, setRevoking] = createSignal<Token | null>(null)
    const [revokeFailure, setRevokeFailure] = createSignal<string | null>(null)

    async function load() {
        try {
            setTokens(await listTokens())
            setLoadFailure(null)
        } catch (error) {
            console.error('listing API tokens failed', error)
            setLoadFailure(describeFailure(error).form ?? 'Could not load your tokens.')
        }
    }

    async function confirmRevoke(token: Token) {
        try {
            await revokeToken(token.id)
        } catch (error) {
            console.error('revoking an API token failed', error)
            const failure = describeFailure(error)
            // Already gone is the outcome that was asked for: just refresh.
            if (failure.form !== 'That token is already gone.') {
                setRevokeFailure(failure.form ?? 'Could not revoke that token.')
                setRevoking(null)
                return
            }
        }
        setRevokeFailure(null)
        setRevoking(null)
        await load()
    }

    onSettled(() => {
        void load()
    })

    return (
        <section class="tokens" aria-busy={tokens() === null && loadFailure() === null ? 'true' : undefined}>
            <div class="tokens__head">
                <h1 class="t-screen-title">API tokens</h1>
                <Button onClick={() => setCreating(true)}>Create token</Button>
            </div>
            <p class="t-body">
                A token lets a script act as you with only the permissions you give it. Revoke one the
                moment it is no longer needed.
            </p>
            <Show when={loadFailure()}>
                {(message) => (
                    <Banner hue="rust" role="alert" action="Try again" onAction={() => void load()}>
                        {message()}
                    </Banner>
                )}
            </Show>
            <Show when={revokeFailure()}>
                {(message) => (
                    <Banner hue="rust" role="alert" onDismiss={() => setRevokeFailure(null)}>
                        {message()}
                    </Banner>
                )}
            </Show>
            <Show when={tokens()}>
                {(list) => (
                    <>
                        <Show when={list().length === 0}>
                            <p class="t-meta">No API tokens yet.</p>
                        </Show>
                        <ul class="tokens__list" aria-label="API tokens">
                            <For each={list()} keyed={(token) => token.id}>
                                {(token) => (
                                    <li class="tokens__row">
                                        <div>
                                            <div class="t-cell">{token().label}</div>
                                            <div class="t-meta">{token().scopes.join(', ')}</div>
                                            <div class="t-meta tokens__meta">
                                                <span>Created {date(token().created_at)}</span>
                                                <span>
                                                    Last used{' '}
                                                    {token().last_used_at ? date(token().last_used_at!) : 'Never'}
                                                </span>
                                            </div>
                                        </div>
                                        <Button
                                            variant="secondary"
                                            aria-label={`Revoke ${token().label}`}
                                            onClick={() => setRevoking(token())}
                                        >
                                            Revoke
                                        </Button>
                                    </li>
                                )}
                            </For>
                        </ul>
                    </>
                )}
            </Show>
            <Show when={creating()}>
                <CreateTokenDialog onCreated={() => void load()} onClose={() => setCreating(false)} />
            </Show>
            <Show when={revoking()}>
                {(token) => (
                    <Modal
                        title={`Revoke "${token().label}"?`}
                        consequence="Anything using this token stops working straight away. This cannot be undone."
                        confirm="Revoke token"
                        destructive
                        onConfirm={() => void confirmRevoke(token())}
                        onCancel={() => setRevoking(null)}
                    />
                )}
            </Show>
        </section>
    )
}
