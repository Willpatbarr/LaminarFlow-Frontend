import { createSignal, onSettled, Show, untrack } from 'solid-js'

import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

import { describeProblem, type FormErrors } from '../formErrors'
import { login, session } from '../session'
import './SessionExpiredBanner.css'

type SessionExpiredBannerProps = {
    /** The user signed in again. `sameAccount` is false when they signed in as
     *  someone else, whose first screen is not the one they were on. */
    onSignedIn?: (result: { sameAccount: boolean }) => void
    /** Changes that have not reached the server. Said here, once, so the rail
     *  does not need a row of its own for them while signed out. */
    waiting?: number
}

// Shown when the server turned the session down while the user was in the app
// (`session.expired`). It replaces the redirect to /login for that case: the
// screen, the route and every unsent change stay exactly as they were, and the
// banner asks for a sign-in in place.
//
// Not shown for a visitor who arrives with no session - that is `anonymous`,
// the guard redirects, and this never renders.
export function SessionExpiredBanner(props: SessionExpiredBannerProps) {
    const [open, setOpen] = createSignal(false)

    return (
        <Show when={session.expired}>
            <Banner
                action="Sign in"
                onAction={() => setOpen(!open())}
                actionExpanded={open()}
                details={
                    <Show when={open()}>
                        <SignInAgain onSignedIn={props.onSignedIn} />
                    </Show>
                }
            >
                You've been signed out. Your changes are saved on this device and will sync when
                you sign back in.
                {props.waiting ? ` ${props.waiting} ${props.waiting === 1 ? 'change' : 'changes'} waiting.` : ''}
            </Banner>
        </Show>
    )
}

// The login form, compact, with the email already filled in from the last
// answer of /auth/me. Same call, same error mapping as the login screen; what
// differs is what happens after, which is the session store's business: it
// clears `expired`, and the sync layer sees whether the account is the same.
function SignInAgain(props: SessionExpiredBannerProps) {
    // The account whose changes are waiting. Read once: by the time the login
    // has answered, `session.me` is already the new account.
    // `untrack` says the one-off read is meant.
    const before = untrack(() => session.me?.account_id)
    const [email, setEmail] = createSignal(untrack(() => session.me?.email) ?? '')
    const [password, setPassword] = createSignal('')
    const [errors, setErrors] = createSignal<FormErrors>({})
    const [pending, setPending] = createSignal(false)

    let passwordEl!: HTMLInputElement
    let emailEl!: HTMLInputElement

    // With the email known, the password is the next thing to type. This is
    // the reader's own action (they pressed Sign in), so moving focus is
    // not a surprise.
    onSettled(() => {
        passwordEl.focus()
    })

    async function submit(event: SubmitEvent) {
        event.preventDefault()
        if (pending()) return

        const found: FormErrors = {}
        if (!email().trim()) found.email = 'Enter your email.'
        if (!password()) found.password = 'Enter your password.'
        if (found.email || found.password) {
            setErrors(found)
            ;(found.email ? emailEl : passwordEl).focus()
            return
        }

        setErrors({})
        setPending(true)
        try {
            await login(email().trim(), password())
        } catch (error) {
            setPending(false)
            setErrors(describeProblem(error))
            passwordEl.focus()
            return
        }
        setPending(false)
        props.onSignedIn?.({ sameAccount: session.me?.account_id === before })
    }

    return (
        <form class="reauth" novalidate onSubmit={submit}>
            <Input
                label="Email"
                type="email"
                name="email"
                autocomplete="email"
                ref={(el) => (emailEl = el)}
                value={email()}
                onInput={(value) => {
                    setEmail(value)
                    setErrors((prev) => ({ ...prev, email: undefined }))
                }}
                error={errors().email}
            />
            <Input
                label="Password"
                type="password"
                name="password"
                autocomplete="current-password"
                ref={(el) => (passwordEl = el)}
                value={password()}
                onInput={(value) => {
                    setPassword(value)
                    setErrors((prev) => ({ ...prev, password: undefined }))
                }}
                error={errors().password}
            />
            <Show when={errors().form}>
                <p class="reauth__status t-meta" role="alert">
                    {errors().form}
                </p>
            </Show>
            <p class="reauth__hint t-meta">
                Sign in with the same account to keep your changes. A different account starts
                fresh, and these changes are discarded.
            </p>
            <div>
                <Button type="submit" disabled={pending()}>
                    {pending() ? 'Signing in…' : 'Sign in'}
                </Button>
            </div>
        </form>
    )
}
