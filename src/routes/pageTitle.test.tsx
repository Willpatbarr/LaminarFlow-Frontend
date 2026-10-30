import { render } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { describe, expect, it } from 'vitest'

import { pageTitle, usePageTitle } from './pageTitle'

function Page(props: { name: () => string | undefined }) {
    usePageTitle(props.name)
    return null
}

describe('pageTitle', () => {
    it('is "<name> · LaminarFlow", or just the app name for no name', () => {
        expect(pageTitle('Board')).toBe('Board · LaminarFlow')
        expect(pageTitle('  Fix login  ')).toBe('Fix login · LaminarFlow')
        expect(pageTitle(undefined)).toBe('LaminarFlow')
        expect(pageTitle('   ')).toBe('LaminarFlow')
    })
})

describe('usePageTitle', () => {
    it('sets the tab title and follows the name as it changes', async () => {
        const [name, setName] = createSignal<string | undefined>(undefined)
        render(() => <Page name={name} />)
        await Promise.resolve()
        expect(document.title).toBe('LaminarFlow')
        setName('Untitled document')
        await Promise.resolve()
        expect(document.title).toBe('Untitled document · LaminarFlow')
        setName('Spec')
        await Promise.resolve()
        expect(document.title).toBe('Spec · LaminarFlow')
    })
})
