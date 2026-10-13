import { createSignal, flush, Show } from 'solid-js'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

import { describeProblem } from '../formErrors'
import { register } from '../session'
import { AuthCard } from './AuthCard'

type SignUpFormProps = {
    /** Runs once the session store holds the new account. Optional because a
     *  route may react to the session instead (see useRedirectIfAuthenticated). */
    onSuccess?: () => void
    /** The link to the other auth screen, for a route that wants to carry
     *  `returnTo` across. */
    loginHref?: string
}

// The specimen asks for a first and last name; the backend stores one
// display_name. The two are joined with a space on the way out.
type Field = 'firstName' | 'email' | 'password' | 'confirm'
type Errors = Partial<Record<Field | 'form', string>>

export function SignUpForm(props: SignUpFormProps) {
    const [firstName, setFirstName] = createSignal('')
    const [lastName, setLastName] = createSignal('')
    const [email, setEmail] = createSignal('')
    const [password, setPassword] = createSignal('')
    const [confirm, setConfirm] = createSignal('')
    const [errors, setErrors] = createSignal<Errors>({})
    const [pending, setPending] = createSignal(false)

    let firstNameEl!: HTMLInputElement
    let emailEl!: HTMLInputElement
    let passwordEl!: HTMLInputElement
    let confirmEl!: HTMLInputElement

    // Focus goes to the first invalid control in the order the form shows
    // them. The flush lets the messages render before focus arrives.
    function showErrors(found: Errors) {
        setErrors(found)
        flush()
        if (found.firstName) firstNameEl.focus()
        else if (found.email) emailEl.focus()
        else if (found.password) passwordEl.focus()
        else if (found.confirm) confirmEl.focus()
    }

    function clear(field: Field) {
        setErrors((prev) => ({ ...prev, [field]: undefined }))
    }

    async function submit(event: SubmitEvent) {
        event.preventDefault()
        if (pending()) return

        // What can be known without asking the server. The password's length is
        // deliberately not checked here: the server owns that rule (10
        // characters, 72 bytes) and its answer lands on the field either way.
        const found: Errors = {}
        if (!firstName().trim()) found.firstName = 'Enter your first name.'
        if (!email().trim()) found.email = 'Enter your email.'
        if (!password()) found.password = 'Choose a password.'
        // The confirmation never leaves the browser - the API has no field for
        // it - so this is the only place a mismatch can be caught.
        if (confirm() !== password()) found.confirm = 'Passwords do not match.'
        if (Object.keys(found).length > 0) {
            showErrors(found)
            return
        }

        setErrors({})
        setPending(true)
        try {
            const displayName = [firstName().trim(), lastName().trim()].filter(Boolean).join(' ')
            await register(email().trim(), password(), displayName)
        } catch (error) {
            setPending(false)
            const { displayName, ...rest } = describeProblem(error)
            showErrors({ ...rest, firstName: displayName })
            return
        }
        setPending(false)
        props.onSuccess?.()
    }

    return (
        <AuthCard
            title="Create your account"
            onSubmit={submit}
            footer={
                <>
                    Already have an account? <a href={props.loginHref ?? '/login'}>Sign in</a>
                </>
            }
        >
            <Input
                label="First name"
                name="firstName"
                autocomplete="given-name"
                ref={(el) => (firstNameEl = el)}
                value={firstName()}
                onInput={(value) => {
                    setFirstName(value)
                    clear('firstName')
                }}
                error={errors().firstName}
            />
            {/* Optional: not everyone has a last name, and the API wants one
                display name, not two. */}
            <Input
                label="Last name"
                name="lastName"
                autocomplete="family-name"
                value={lastName()}
                onInput={setLastName}
            />
            <Input
                label="Email"
                type="email"
                name="email"
                autocomplete="email"
                ref={(el) => (emailEl = el)}
                value={email()}
                onInput={(value) => {
                    setEmail(value)
                    clear('email')
                }}
                error={errors().email}
            />
            <Input
                label="Password"
                type="password"
                name="password"
                autocomplete="new-password"
                ref={(el) => (passwordEl = el)}
                value={password()}
                onInput={(value) => {
                    setPassword(value)
                    clear('password')
                }}
                error={errors().password}
            />
            <Input
                label="Confirm password"
                type="password"
                name="confirmPassword"
                autocomplete="new-password"
                ref={(el) => (confirmEl = el)}
                value={confirm()}
                onInput={(value) => {
                    setConfirm(value)
                    clear('confirm')
                }}
                error={errors().confirm}
            />
            <Show when={errors().form}>
                <p class="auth__status t-meta" role="alert">
                    {errors().form}
                </p>
            </Show>
            <div class="auth__actions">
                <Button type="submit" disabled={pending()}>
                    {pending() ? 'Creating account…' : 'Sign up'}
                </Button>
            </div>
        </AuthCard>
    )
}
