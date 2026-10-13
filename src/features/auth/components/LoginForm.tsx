import { createSignal, flush, Show } from 'solid-js'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

import { describeProblem, type FormErrors } from '../formErrors'
import { login } from '../session'
import { AuthCard } from './AuthCard'

type LoginFormProps = {
    /** Runs once the session store holds the new account. Optional because a
     *  route may react to the session instead (see useRedirectIfAuthenticated). */
    onSuccess?: () => void
    /** The link to the other auth screen, for a route that wants to carry
     *  `returnTo` across. */
    signUpHref?: string
}

// Where to go afterwards is the route's decision, not this form's, which is
// why it takes a callback instead of calling the router.
export function LoginForm(props: LoginFormProps) {
    const [email, setEmail] = createSignal('')
    const [password, setPassword] = createSignal('')
    const [errors, setErrors] = createSignal<FormErrors>({})
    const [pending, setPending] = createSignal(false)

    let emailEl!: HTMLInputElement
    let passwordEl!: HTMLInputElement

    // Moves focus to the first thing the user must fix, so a keyboard or
    // screen-reader user lands on the message instead of hunting for it. The
    // flush lets the message render first, so the field is already described
    // by it when focus arrives.
    function showErrors(found: FormErrors) {
        setErrors(found)
        flush()
        if (found.email) emailEl.focus()
        else if (found.password || found.form) passwordEl.focus()
    }

    async function submit(event: SubmitEvent) {
        event.preventDefault()
        if (pending()) return

        // Only "you left it empty" is caught here. Whether the credentials are
        // right is the server's answer to give.
        const found: FormErrors = {}
        if (!email().trim()) found.email = 'Enter your email.'
        if (!password()) found.password = 'Enter your password.'
        if (found.email || found.password) {
            showErrors(found)
            return
        }

        setErrors({})
        setPending(true)
        try {
            await login(email().trim(), password())
        } catch (error) {
            setPending(false)
            showErrors(describeProblem(error))
            return
        }
        setPending(false)
        props.onSuccess?.()
    }

    return (
        <AuthCard
            title="Sign in"
            onSubmit={submit}
            footer={
                <>
                    No account yet? <a href={props.signUpHref ?? '/signup'}>Sign up</a>
                </>
            }
        >
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
                <p class="auth__status t-meta" role="alert">
                    {errors().form}
                </p>
            </Show>
            <div class="auth__actions">
                <Button type="submit" disabled={pending()}>
                    {pending() ? 'Signing in…' : 'Sign in'}
                </Button>
            </div>
        </AuthCard>
    )
}
