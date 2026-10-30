import { useSearchParams } from '@solidjs/router'

import { useRedirectIfAuthenticated, withReturnTo } from '@/features/auth'
import { SignUpForm } from '@/features/auth/components/SignUpForm'

import { usePageTitle } from './pageTitle'

export function SignUpPage() {
    usePageTitle(() => 'Create your account')
    useRedirectIfAuthenticated()
    const [params] = useSearchParams()
    return <SignUpForm loginHref={withReturnTo('/login', params.returnTo)} />
}
