import { Portal, type JSX } from '@solidjs/web'
import { createEffect, createSignal, createUniqueId, Show } from 'solid-js'

import './Popover.css'

/** What a trigger must spread onto its button: the wiring the pattern needs. */
export type PopoverTriggerProps = {
    ref: (el: HTMLElement) => void
    'aria-haspopup': 'dialog' | 'menu'
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
     *  and activating one closes the popover. */
    role?: 'dialog' | 'menu'
    /** Where to hang the panel when there is no trigger. Defaults to the trigger. */
    anchor?: HTMLElement | { x: number; y: number }
    /** Controlled use. Omit both for the popover to keep its own state. */
    open?: boolean
    onOpenChange?: (open: boolean) => void
    /** Which edge of the anchor the panel lines up with. Default `end`. */
    align?: 'start' | 'end'
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
    const panelId = `${id}-panel`
    const [own, setOwn] = createSignal(false)
    const controlled = () => props.open !== undefined
    const isOpen = () => (controlled() ? props.open === true : own() && openId() === id)
    let trigger: HTMLElement | undefined
    let panel: HTMLDivElement | undefined

    const role = () => props.role ?? 'dialog'

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
        if (!panel) return
        const anchor = props.anchor
        const rect =
            anchor && !(anchor instanceof HTMLElement)
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
        const wanted = (props.align ?? 'end') === 'end' ? rect.right - width : rect.left
        const left = Math.max(MARGIN, Math.min(wanted, vw - width - MARGIN))
        panel.style.maxHeight = `${Math.max(space, 120)}px`
        panel.style.top = `${Math.max(MARGIN, top)}px`
        panel.style.left = `${left}px`
        panel.dataset.placement = flip ? 'top' : 'bottom'
    }

    createEffect(isOpen, (opened) => {
        if (!opened) return
        place()
        const first =
            role() === 'menu' ? panel?.querySelector<HTMLElement>(MENU_ITEMS) : panel?.querySelector<HTMLElement>(FOCUSABLE)
        ;(first ?? panel)?.focus({ preventScroll: true })

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
        if (role() !== 'menu' || !panel) return
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
                    <div
                        ref={(el) => {
                            panel = el
                        }}
                        id={panelId}
                        class="popover"
                        role={role()}
                        aria-label={props.label}
                        tabindex="-1"
                        onKeyDown={onPanelKeyDown}
                        onClick={onPanelClick}
                    >
                        {typeof props.children === 'function' ? props.children(close) : props.children}
                    </div>
                </Portal>
            </Show>
        </>
    )
}
