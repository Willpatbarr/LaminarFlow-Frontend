import { PageLayout } from '@/components/ui/PageLayout'
import { SettingsScreen } from '@/features/settings/SettingsScreen'

import { usePageTitle } from './pageTitle'

// /settings. Every setting in one place (LAM-200).
export function SettingsPage() {
    usePageTitle(() => 'Settings')
    return (
        <PageLayout>
            <SettingsScreen />
        </PageLayout>
    )
}
