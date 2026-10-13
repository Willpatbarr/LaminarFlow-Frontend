import { useNavigate } from '@solidjs/router'

import { LoginForm } from '@/features/auth/components/LoginForm'

// Wiring only: the form owns the screen, this decides where success goes.
// Route protection and a smarter destination than "/" are LAM-63's.
export function LoginPage() {
    const navigate = useNavigate()
    return <LoginForm onSuccess={() => navigate('/')} />
}
