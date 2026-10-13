import { useNavigate } from '@solidjs/router'

import { SignUpForm } from '@/features/auth/components/SignUpForm'

export function SignUpPage() {
    const navigate = useNavigate()
    return <SignUpForm onSuccess={() => navigate('/')} />
}
