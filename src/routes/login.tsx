import { useSearchParams } from '@solidjs/router'

import { useRedirectIfAuthenticated, withReturnTo } from '@/features/auth'
import { LoginForm } from '@/features/auth/components/LoginForm'

// Wiring only. Where a successful login goes (`returnTo`, or home) is decided
// by the redirect hook, which also covers opening /login already signed in.
export function LoginPage() {
    useRedirectIfAuthenticated()
    const [params] = useSearchParams()
    // The way across to sign-up carries the destination, so someone who
    // deep-linked in and has no account yet still ends up where they were going.
    return <LoginForm signUpHref={withReturnTo('/signup', params.returnTo)} />
}
