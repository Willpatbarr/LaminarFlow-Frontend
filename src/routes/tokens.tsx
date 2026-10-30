import { TokensScreen } from '@/features/tokens/components/TokensScreen'

import { usePageTitle } from './pageTitle'

// /settings/tokens. The signed-in account's API tokens (LAM-101).
export function TokensPage() {
    usePageTitle(() => 'API tokens')
    return <TokensScreen />
}
