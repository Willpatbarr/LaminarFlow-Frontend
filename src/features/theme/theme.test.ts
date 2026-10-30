import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The theme module (LAM-144): the saved choice, the System default, and System
// following the OS while the app is open. jsdom has no matchMedia, so a small
// fake that can flip and notify stands in for the OS.

type Listener = () => void
let osLight = false
let listeners: Listener[] = []

function fakeMatchMedia() {
    return vi.fn((query: string) => ({
        get matches() {
            return query.includes('light') && osLight
        },
        media: query,
        addEventListener: (_: string, fn: Listener) => listeners.push(fn),
        removeEventListener: () => {},
    }))
}

function head() {
    document.head.innerHTML = '<meta name="color-scheme" content="dark light"><meta name="theme-color" content="#0d1013">'
    document.documentElement.removeAttribute('data-theme')
}

const meta = (name: string) => document.querySelector(`meta[name="${name}"]`)!.getAttribute('content')
const attr = () => document.documentElement.getAttribute('data-theme')

async function load() {
    vi.resetModules()
    return import('./theme')
}

beforeEach(() => {
    osLight = false
    listeners = []
    localStorage.clear()
    head()
    vi.stubGlobal('matchMedia', fakeMatchMedia())
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('theme', () => {
    it('defaults to System when nothing is saved, with no attribute', async () => {
        const t = await load()
        expect(t.theme()).toBe('system')
        t.applyTheme()
        expect(attr()).toBeNull()
        expect(meta('color-scheme')).toBe('dark light')
    })

    it('reads a saved choice and ignores junk', async () => {
        localStorage.setItem('lf-theme', 'light')
        expect((await load()).theme()).toBe('light')
        localStorage.setItem('lf-theme', 'purple')
        expect((await load()).theme()).toBe('system')
    })

    it('saves a choice, sets the attribute, form colour scheme and browser chrome colour', async () => {
        const t = await load()
        t.setTheme('light')
        expect(localStorage.getItem('lf-theme')).toBe('light')
        expect(attr()).toBe('light')
        expect(meta('color-scheme')).toBe('light')
        expect(meta('theme-color')).toBe(t.THEME_COLOR.light)
        t.setTheme('dark')
        expect(attr()).toBe('dark')
        expect(meta('theme-color')).toBe(t.THEME_COLOR.dark)
    })

    it('System removes the attribute and the saved value', async () => {
        const t = await load()
        t.setTheme('dark')
        t.setTheme('system')
        expect(attr()).toBeNull()
        expect(localStorage.getItem('lf-theme')).toBeNull()
    })

    it('System follows the OS while open, and an explicit choice does not', async () => {
        const t = await load()
        t.applyTheme()
        expect(meta('theme-color')).toBe(t.THEME_COLOR.dark)
        osLight = true
        listeners.forEach((fn) => fn())
        expect(meta('theme-color')).toBe(t.THEME_COLOR.light)

        t.setTheme('dark')
        osLight = true
        listeners.forEach((fn) => fn())
        expect(meta('theme-color')).toBe(t.THEME_COLOR.dark)
    })

    it('still works when storage throws', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked')
        })
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked')
        })
        const t = await load()
        expect(t.theme()).toBe('system')
        t.setTheme('light')
        expect(t.theme()).toBe('light')
        expect(attr()).toBe('light')
    })
})
