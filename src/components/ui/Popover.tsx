import { Portal, type JSX } from '@solidjs/web'
import { createEffect, createSignal, createUniqueId, Show, untrack } from 'solid-js'

import { Button } from './Button'
import { useNarrowScreen } from './useNarrowScreen'
import './Popover.css'

/** What a trigger must spread onto its button: the wiring the pattern needs. */
export type PopoverTriggerProps = {
    ref: (el: HTMLElement) => void
    'aria-haspopup': 'dialog' | 'menu' | 'listbox'
    'aria-expanded': 'true' | 'false'
    'aria-controls': string | undefined
    onClick: () => void
}

type PopoverProps = {
    /** Names the panel for assistive technology ("Column To Do"). */
    label: string
    /** The control that opens it. Receives the props to spread on it; the panel
     *  anchors to it and focus returns to it on close. Leave it out to drive the
     *  popover with `open` and `anchor` alone (an @ picker inside a text field). */
    trigger?: (trigger: PopoverTriggerProps) => JSX.Element
    /** Mounted only while open. A function receives `close`. */
    children: JSX.Element | ((close: () => void) => JSX.Element)
    /** `dialog` (default) is the disclosure pattern, for a panel that holds form
     *  controls: Tab moves through it. `menu` is the WAI-ARIA menu: children are
     *  `role="menuitem"` elements, arrow keys / Home / End move between them,
     *  and activating one closes the popover. `listbox` is for a list that
     *  belongs to a field whose focus stays put (an `@` picker in the editor):
     *  it never takes focus, and a press inside it does not move focus either.
     *  The owner drives the highlight (`aria-activedescendant` on the field)
     *  and picks. */
    role?: 'dialog' | 'menu' | 'listbox'
    /** The panel's id, for the owner's `aria-controls`. */
    id?: string
    /** Where to hang the panel when there is no trigger. Defaults to the trigger.
     *  A function is read each time the panel is placed (a caret rect that moves
     *  with scrolling); pass a new one to have the panel placed again. */
    anchor?: HTMLElement | { x: number; y: number } | (() => DOMRect | null)
    /** Controlled use. Omit both for the popover to keep its own state. */
    open?: boolean
    onOpenChange?: (open: boolean) => void
    /** Which edge of the anchor the panel lines up with. Default `end`. */
    align?: 'start' | 'end'
    /** How the panel is shown. `popover` (default) hangs it off the anchor.
     *  `sheet` is a bottom sheet: full width, pinned to the bottom, scrolls
     *  inside, with a grab bar, a visible Done button and a dimmed backdrop
     *  (`aria-modal`; Tab stays inside). `auto` is a sheet at phone width
     *  (`useNarrowScreen`) and a popover elsewhere. A `listbox` is always a
     *  popover: it never takes focus. Same close rules either way. */
    presentation?: 'popover' | 'sheet' | 'auto'
}

const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const MENU_ITEMS = '[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemcheckbox"], [role="menuitemradio"]'
const MARGIN = 8
const GAP = 4

// Only one popover is open at a time: opening one closes whichever was open.
const [openId, setOpenId] = createSignal<string | null>(null)

// A panel in a portal (so no scroll area or `overflow: hidden` can clip it),
// placed against its anchor with `position: fixed`, flipped above the anchor
// when there is no room below and shifted so it stays inside the viewport.
//
// Mount-on-open. Escape, a press outside, and activating a menu item or any
// element marked `data-popover-close` close it. Focus moves in on open and
// goes back to the trigger on close (after an outside press, only if focus
// would otherwise be lost: the press may have landed on something else).
export function Popover(props: PopoverProps) {
    const id = createUniqueId()
    const panelId = props.id ?? `${id}-panel`
    const [own, setOwn] = createSignal(false)
    const controlled = () => props.open !== undefined
    const isOpen = () => (controlled() ? props.open === true : own() && openId() === id)
    let trigger: HTMLElement | undefined
    let panel: HTMLDivElement | undefined

    const role = () => props.role ?? 'dialog'
    const narrow = useNarrowScreen()
    const isSheet = () => {
        const mode = props.presentation ?? 'popover'
        return role() !== 'listbox' && (mode === 'sheet' || (mode === 'auto' && narrow()))
    }

    function setOpen(next: boolean) {
        if (next) setOpenId(id)
        else if (openId() === id) setOpenId(null)
        if (!controlled()) setOwn(next)
        props.onOpenChange?.(next)
    }

    function close(returnFocus = true) {
        if (returnFocus && trigger?.isConnected) trigger.focus()
        setOpen(false)
    }

    const anchorEl = () => {
        const anchor = props.anchor
        return anchor instanceof HTMLElement ? anchor : anchor ? null : trigger
    }

    function place() {
        if (!panel || untrack(isSheet)) return
        // Called from events and effects alike: never a tracking scope of its own.
        const anchor = untrack(() => props.anchor)
        const rect =
            typeof anchor === 'function'
                ? anchor()
                : anchor && !(anchor instanceof HTMLElement)
                  ? { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y }
                  : anchorEl()?.getBoundingClientRect()
        if (!rect) return
        const vw = document.documentElement.clientWidth
        const vh = window.innerHeight
        // Measure at natural size, capped to the viewport so it can always fit.
        panel.style.maxHeight = `${vh - 2 * MARGIN}px`
        const width = panel.offsetWidth
        const height = panel.offsetHeight
        const below = vh - rect.bottom - GAP - MARGIN
        const above = rect.top - GAP - MARGIN
        const flip = height > below && above > below
        const space = flip ? above : below
        const top = flip ? rect.top - GAP - Math.min(height, space) : rect.bottom + GAP
        const wanted = (untrack(() => props.align) ?? 'end') === 'end' ? rect.right - width : rect.left
        const left = Math.max(MARGIN, Math.min(wanted, vw - width - MARGIN))
        panel.style.maxHeight = `${Math.max(space, 120)}px`
        panel.style.top = `${Math.max(MARGIN, top)}px`
        panel.style.left = `${left}px`
        panel.dataset.placement = flip ? 'top' : 'bottom'
    }

    // The caret moves while a list is open at it: follow it.
    createEffect(
        () => props.anchor,
        () => place(),
    )

    createEffect(isOpen, (opened) => {
        if (!opened) return
        place()
        if (role() !== 'listbox') {
            const first =
                role() === 'menu'
                    ? panel?.querySelector<HTMLElement>(MENU_ITEMS)
                    : panel?.querySelector<HTMLElement>(FOCUSABLE)
            ;(first ?? panel)?.focus({ preventScroll: true })
        }

        const onPointerDown = (event: Event) => {
            const target = event.target as Node
            if (panel?.contains(target) || trigger?.contains(target)) return
            close(false)
            // Focus the press landed on stays; otherwise do not strand it.
            queueMicrotask(() => {
                const at = document.activeElement
                if ((at === document.body || at === null) && trigger?.isConnected) trigger.focus()
            })
        }
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return
            event.preventDefault()
            close()
        }
        const onMove = () => place()
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKey)
        window.addEventListener('resize', onMove)
        window.addEventListener('scroll', onMove, true)
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true)
            document.removeEventListener('keydown', onKey)
            window.removeEventListener('resize', onMove)
            window.removeEventListener('scroll', onMove, true)
        }
    })

    function onPanelKeyDown(event: KeyboardEvent) {
        if (!panel) return
        if (isSheet() && event.key === 'Tab') {
            // aria-modal: Tab wraps inside the sheet.
            const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
            if (items.length === 0) return
            const first = items[0]
            const last = items[items.length - 1]
            if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
                event.preventDefault()
                last.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first.focus()
            }
            return
        }
        if (role() !== 'menu') return
        const items = [...panel.querySelectorAll<HTMLElement>(MENU_ITEMS)]
        if (items.length === 0) return
        const at = items.indexOf(document.activeElement as HTMLElement)
        let next: number | null = null
        if (event.key === 'ArrowDown') next = (at + 1) % items.length
        else if (event.key === 'ArrowUp') next = at <= 0 ? items.length - 1 : at - 1
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = items.length - 1
        else if (event.key === 'Tab') {
            // A menu is one tab stop: Tab leaves it.
            close()
            return
        }
        if (next === null) return
        event.preventDefault()
        items[next].focus()
    }

    function onPanelClick(event: MouseEvent) {
        const target = event.target as HTMLElement
        const closer = role() === 'menu' ? target.closest(MENU_ITEMS) : target.closest('[data-popover-close]')
        if (closer && panel?.contains(closer)) close()
    }

    const body = () => (typeof props.children === 'function' ? props.children(close) : props.children)

    const triggerProps: PopoverTriggerProps = {
        ref: (el) => {
            trigger = el
        },
        'aria-haspopup': role(),
        get 'aria-expanded'() {
            return isOpen() ? 'true' : 'false'
        },
        get 'aria-controls'() {
            return isOpen() ? panelId : undefined
        },
        onClick: () => (isOpen() ? close() : setOpen(true)),
    }

    return (
        <>
            {props.trigger?.(triggerProps)}
            <Show when={isOpen()}>
                <Portal>
                    <div class={`${isSheet() ? 'sheet-backdrop' : 'popover-host'}`}>
                    <div
                        ref={(el) => {
                            panel = el
                        }}
                        id={panelId}
                        class={`popover${isSheet() ? ' popover--sheet' : ''}`}
                        role={isSheet() ? 'dialog' : role()}
                        aria-modal={isSheet() ? 'true' : undefined}
                        aria-label={props.label}
                        tabindex={role() === 'listbox' ? undefined : '-1'}
                        onMouseDown={(event: MouseEvent) => {
                            // Keep focus where it is (in the field) when an option is pressed.
                            if (role() === 'listbox') event.preventDefault()
                        }}
                        onKeyDown={onPanelKeyDown}
                        onClick={onPanelClick}
                    >
                        <Show when={isSheet()} fallback={body()}>
                            <div class="sheet__grab" aria-hidden="true" />
                            <div class="sheet__body" role={role() === 'menu' ? 'menu' : undefined}>
                                {body()}
                            </div>
                            <div class="sheet__footer">
                                <Button variant="secondary" onClick={() => close()}>
                                    Done
                                </Button>
                            </div>
                        </Show>
                    </div>
                    </div>
                </Portal>
            </Show>
        </>
    )
}
