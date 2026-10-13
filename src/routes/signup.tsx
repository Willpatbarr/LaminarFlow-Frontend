import { useSearchParams } from '@solidjs/router'

import { useRedirectIfAuthenticated, withReturnTo } from '@/features/auth'
import { SignUpForm } from '@/features/auth/components/SignUpForm'

export function SignUpPage() {
    useRedirectIfAuthenticated()
    const [params] = useSearchParams()
    return <SignUpForm loginHref={withReturnTo('/login', params.returnTo)} />
}
