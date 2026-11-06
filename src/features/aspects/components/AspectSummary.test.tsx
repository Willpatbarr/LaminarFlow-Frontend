import { render, screen, within } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'

import { AspectSummary } from './AspectSummary'

const field = (id: string, label: string, position: number) => ({ id, label, position })

describe('AspectSummary', () => {
    it('has a row per field, with each line of its value on a line of its own', () => {
        render(() => (
            <AspectSummary
                fields={[field('role', 'Role', 1), field('pi', 'PrimaryInteractions', 2), field('notes', 'Notes', 3)]}
                body={{ role: 'Tank', pi: 'bosses\n\nteammates\n\nenvironment' }}
            />
        ))

        const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
        expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual(['Role', 'PrimaryInteractions', 'Notes'])

        const lines = rows[1]!.querySelectorAll('.aspect-summary__line')
        expect([...lines].map((line) => line.textContent)).toEqual(['bosses', 'teammates', 'environment'])
        expect(within(rows[2]!).getByRole('cell')).toHaveTextContent('—')
    })

    it('draws nothing for a type with no fields', () => {
        render(() => <AspectSummary fields={[]} body={{}} />)
        expect(screen.queryByRole('table')).toBeNull()
    })
})
