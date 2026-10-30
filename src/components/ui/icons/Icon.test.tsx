import { render, screen } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'

import { Icon } from './Icon'
import { ICON_PATHS } from './paths'

describe('Icon', () => {
    it('is decorative by default', () => {
        const { container } = render(() => <Icon name="list" />)
        const svg = container.querySelector('svg')!
        expect(svg).toHaveAttribute('aria-hidden', 'true')
        expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
        expect(svg.querySelector('path')).toHaveAttribute('d', ICON_PATHS.list)
    })

    it('is named when used alone', () => {
        render(() => <Icon name="key" label="API token" />)
        expect(screen.getByRole('img', { name: 'API token' })).toBeInTheDocument()
    })

    it('keeps the coolicons paths for the three binding nav icons', () => {
        // File/File_Document, Edit/Table, File/Notebook from the vault.
        expect(ICON_PATHS.document.startsWith('M9 17H15M9 14H15M13.0004 3.00087')).toBe(true)
        expect(ICON_PATHS.views.startsWith('M4 15V16.8002')).toBe(true)
        expect(ICON_PATHS.project.startsWith('M8 4H7.2002')).toBe(true)
    })
})
