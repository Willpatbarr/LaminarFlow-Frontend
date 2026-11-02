import { describe, expect, it } from 'vitest'

import { contextActions, nameProblem, OFFLINE_REASON } from './contextActions'

const holding = (...held: string[]) => (permission: string) => held.includes(permission)
const team = { name: 'Core' }

describe('contextActions (LAM-199)', () => {
    it('offers New team only with team:write, and a project only with project:write', () => {
        expect(contextActions({ can: holding(), team, offline: false })).toEqual([])
        expect(contextActions({ can: holding('ticket:write', 'team:read'), team, offline: false })).toEqual([])
        expect(contextActions({ can: holding('team:write'), team, offline: false }).map((a) => a.label)).toEqual(['New team'])
        expect(contextActions({ can: holding('project:write'), team, offline: false }).map((a) => a.label)).toEqual([
            'New project in Core',
        ])
        expect(
            contextActions({ can: holding('team:write', 'project:write'), team, offline: false }).map((a) => [a.kind, a.icon]),
        ).toEqual([
            ['team', 'team'],
            ['project', 'project'],
        ])
    })

    it('has no project action without a team in view', () => {
        expect(contextActions({ can: holding('team:write', 'project:write'), offline: false }).map((a) => a.kind)).toEqual(['team'])
    })

    it('keeps the actions while offline, disabled with the reason', () => {
        const actions = contextActions({ can: holding('team:write', 'project:write'), team, offline: true })
        expect(actions).toHaveLength(2)
        for (const action of actions) expect(action.disabledReason).toBe(OFFLINE_REASON)
        expect(contextActions({ can: holding('team:write'), team, offline: false })[0].disabledReason).toBeUndefined()
    })
})

describe('nameProblem', () => {
    it('refuses an empty or blank name, naming what it is', () => {
        expect(nameProblem('Team', '')).toBe('Team name is required.')
        expect(nameProblem('Project', '   ')).toBe('Project name is required.')
        expect(nameProblem('Team', ' Growth ')).toBeUndefined()
    })
})
