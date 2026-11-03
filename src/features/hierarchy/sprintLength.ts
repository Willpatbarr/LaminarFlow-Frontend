import { api } from '@/api/client'

import { DEFAULT_SPRINT_DAYS } from './kinds'

// The team's `sprint.length_days` setting. Settings are not a sync entity, so
// this is a request (as the aspect type calls are). Unset (404 setting_not_set),
// unreadable, offline or a value that is not a whole number above zero: 14.
export async function sprintLengthDays(teamId: string): Promise<number> {
    try {
        const { data } = await api.GET('/api/v1/settings/{key}', {
            params: {
                path: { key: 'sprint.length_days' },
                query: { scope: 'team', target_id: teamId },
            },
        })
        const value = Number(data?.value)
        return Number.isInteger(value) && value > 0 ? value : DEFAULT_SPRINT_DAYS
    } catch {
        return DEFAULT_SPRINT_DAYS
    }
}
