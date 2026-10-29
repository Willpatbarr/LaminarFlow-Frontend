import { useNavigate } from '@solidjs/router'
import { Portal } from '@solidjs/web'
import { createEffect, createMemo, createSignal, createUniqueId, For, onSettled, Show } from 'solid-js'

import { makeDocument } from '@/features/documents/newDocument'
import { useShortcut } from '@/features/shortcuts'
import { sync } from '@/sync'

import { MAX_QUERY, searchServer, type SearchItem } from './api'
import { highlight, parseSnippet, plain, wordsOf, type Piece } from './snippet'
import './search.css'

/*
┌─ search ────────────────────────────────────────
│  CommandPalette: Cmd/Ctrl+K opens a search over tickets, documents and projects (LAM-115)
├─ out ───────────────────────────────────────────
│      CommandPalette   <CommandPalette onNewTicket? documentTarget? />   mounted once, in the app shell
├─ example ───────────────────────────────────────
│      Ctrl+K, type "outbox", ArrowDown, Enter   →   /tickets/<id>
*/
// Results from this device (the local store) show on the first keystroke; the
// server's (POST /search/list) are merged in when they arrive, so a title in
// the store is there at once and a match in a body or a comment follows. A
// server hit on something the store has replaces the local row, since it also
// knows where the match is. If the server cannot be reached the local rows
// stay and the palette says so.
//
// Keys: Ctrl/Cmd+K toggles it from anywhere, including a text field and the
// editor (the shortcut listener lets that chord through both). Inside:
// Up/Down move, Enter opens, Escape closes. Focus stays in the input and the
// highlighted row is announced with aria-activedescendant.

const LOCAL_PER_TYPE = 8
const DEBOUNCE_MS = 150

type Kind = 'command' | 'ticket' | 'document' | 'project' | 'comment'

type Row = {
    key: string
    kind: Kind
    /** Where Enter goes. Absent for a command, which has `run`. */
    href?: string
    run?: () => void
    label: Piece[]
    /** The line under the label: where the match is. */
    detail: Piece[]
    /** Aspect field the match is in. */
    field?: string
    /** Said after the label: "Comment on ticket". */
    note?: string
}

const GROUPS: { kind: Kind; heading: string }[] = [
    { kind: 'command', heading: 'Commands' },
    { kind: 'ticket', heading: 'Tickets' },
    { kind: 'document', heading: 'Documents' },
    { kind: 'project', heading: 'Projects' },
    { kind: 'comment', heading: 'Comments' },
]

const routeOf = (kind: 'ticket' | 'document' | 'project', id: string) =>
    kind === 'ticket' ? `/tickets/${id}` : kind === 'document' ? `/documents/${id}` : `/projects/${id}`

const titled = (title: string) => (title.trim() === '' ? '(untitled)' : title)

function serverRow(item: SearchItem, words: string[]): Row | null {
    const snippet = parseSnippet(item.snippet)
    const title = titled(item.title)
    if (item.type === 'comment') {
        const parent = item.parent_type === 'ticket' || item.parent_type === 'document' ? item.parent_type : null
        if (!parent || !item.parent_id) return null
        return {
            key: `comment:${item.id}`,
            kind: 'comment',
            href: routeOf(parent, item.parent_id),
            label: snippet.length > 0 ? snippet : highlight(title, words),
            detail: [],
            note: `Comment on ${parent}`,
        }
    }
    // A hit in the title shows the snippet as the label; a hit elsewhere keeps
    // the title and shows the snippet under it.
    const inTitle = plain(snippet) === item.title
    return {
        key: `${item.type}:${item.id}`,
        kind: item.type,
        href: routeOf(item.type, item.id),
        label: inTitle ? snippet : highlight(title, words),
        detail: inTitle ? [] : snippet,
        field: item.field_label ?? undefined,
    }
}

function localRows(kind: 'ticket' | 'document' | 'project', words: string[]): Row[] {
    if (words.length === 0) return []
    const source: { id: string; title: string }[] =
        kind === 'ticket'
            ? sync.tickets
            : kind === 'document'
              ? sync.documents
              : sync.projects.map((p) => ({ id: p.id, title: p.name }))
    return source
        .filter((row) => {
            const lower = row.title.toLowerCase()
            return words.every((word) => lower.includes(word))
        })
        .slice(0, LOCAL_PER_TYPE)
        .map((row) => ({
            key: `${kind}:${row.id}`,
            kind,
            href: routeOf(kind, row.id),
            label: highlight(titled(row.title), words),
            detail: [],
        }))
}

function Pieces(props: { pieces: Piece[] }) {
    return <>{props.pieces.map((piece) => (piece.mark ? <mark>{piece.text}</mark> : piece.text))}</>
}

type PaletteProps = {
    /** Offered as a command when the app can make a ticket here. */
    onNewTicket?: () => void
    /** Where "New document" files it: the project in view, else team-wide. Absent: team-wide. */
    documentTarget?: () => { projectId: string | null }
}

export function CommandPalette(props: PaletteProps) {
    const [open, setOpen] = createSignal(false)

    // Ctrl/Cmd+K is declared in the shortcut registry (LAM-124), which also
    // keeps it working from a field and above a dialog.
    useShortcut('palette.toggle', () => setOpen((now) => !now))

    return (
        <Show when={open()}>
            <Palette onNewTicket={props.onNewTicket} documentTarget={props.documentTarget} onClose={() => setOpen(false)} />
        </Show>
    )
}

function Palette(props: PaletteProps & { onClose: () => void }) {
    const navigate = useNavigate()
    const listId = createUniqueId()
    const optionId = (key: string) => `${listId}-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    let input: HTMLInputElement | undefined
    let leaving = false

    const [query, setQuery] = createSignal('')
    const [activeKey, setActiveKey] = createSignal<string | null>(null)
    // What the server last said, and for which query: an answer to an older
    // query is not shown under a newer one. `items` is null when it failed.
    const [server, setServer] = createSignal<{ q: string; items: SearchItem[] | null } | null>(null)

    const trimmed = () => query().trim()
    const words = createMemo(() => wordsOf(trimmed()))
    const answer = () => {
        const last = server()
        return last && last.q === trimmed() ? last : null
    }

    onSettled(() => {
        input?.focus()
        return () => {
            if (!leaving && opener?.isConnected) opener.focus()
        }
    })

    createEffect(trimmed, (q) => {
        if (q === '') return
        const controller = new AbortController()
        const timer = setTimeout(() => {
            void searchServer(q, controller.signal).then((result) => {
                if (!controller.signal.aborted) setServer({ q, items: result.ok ? result.data : null })
            })
        }, DEBOUNCE_MS)
        return () => {
            clearTimeout(timer)
            controller.abort()
        }
    })

    const rows = createMemo<Row[]>(() => {
        const out: Row[] = []
        const w = words()
        const asked = answer()
        if (w.every((word) => 'new document'.includes(word))) {
            out.push({
                key: 'command:new-document',
                kind: 'command',
                run: () => void makeDocument(navigate, props.documentTarget?.()),
                label: [{ text: 'New document', mark: false }],
                detail: [],
            })
        }
        if (props.onNewTicket && w.every((word) => 'new ticket'.includes(word))) {
            out.push({
                key: 'command:new-ticket',
                kind: 'command',
                run: props.onNewTicket,
                label: [{ text: 'New ticket', mark: false }],
                detail: [],
            })
        }
        const fromServer = (asked?.items ?? []).flatMap((item) => serverRow(item, w) ?? [])
        const seen = new Set(fromServer.map((row) => row.key))
        for (const kind of ['ticket', 'document', 'project'] as const) {
            out.push(...fromServer.filter((row) => row.kind === kind))
            out.push(...localRows(kind, w).filter((row) => !seen.has(row.key)))
        }
        out.push(...fromServer.filter((row) => row.kind === 'comment'))
        return out
    })

    const active = () => rows().find((row) => row.key === activeKey()) ?? rows()[0]

    const groups = createMemo(() =>
        GROUPS.map((group) => ({ ...group, rows: rows().filter((row) => row.kind === group.kind) })).filter(
            (group) => group.rows.length > 0,
        ),
    )

    const status = () => {
        if (trimmed() === '') return rows().length > 0 ? '' : 'Type to search tickets, documents and projects.'
        const asked = answer()
        if (asked === null) return 'Searching…'
        if (asked.items === null) return 'Could not reach the server. Showing results from this device.'
        return rows().length === 0 ? 'No results.' : ''
    }

    createEffect(
        () => active()?.key,
        (key) => {
            if (key) document.getElementById(optionId(key))?.scrollIntoView?.({ block: 'nearest' })
        },
    )

    function close() {
        props.onClose()
    }

    function openRow(row: Row | undefined) {
        if (!row) return
        leaving = true
        props.onClose()
        if (row.run) row.run()
        else if (row.href) navigate(row.href)
    }

    function move(by: 1 | -1) {
        const all = rows()
        if (all.length === 0) return
        const at = all.findIndex((row) => row.key === active()?.key)
        setActiveKey(all[(at + by + all.length) % all.length].key)
    }

    function onKeyDown(event: KeyboardEvent) {
        if (event.isComposing) return
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault()
                move(1)
                break
            case 'ArrowUp':
                event.preventDefault()
                move(-1)
                break
            case 'Enter':
                event.preventDefault()
                openRow(active())
                break
            case 'Escape':
                event.preventDefault()
                close()
                break
            case 'Tab':
                // The input is the only stop; the rows are reached with the arrows.
                event.preventDefault()
                break
        }
    }

    return (
        <Portal>
            <div
                class="palette__backdrop"
                onClick={(event) => {
                    if (event.target === event.currentTarget) close()
                }}
            >
                <div class="palette" role="dialog" aria-modal="true" aria-label="Search" onKeyDown={onKeyDown}>
                    <input
                        ref={(el) => {
                            input = el
                        }}
                        class="palette__input"
                        type="text"
                        role="combobox"
                        aria-label="Search tickets, documents and projects"
                        aria-expanded="true"
                        aria-controls={listId}
                        aria-autocomplete="list"
                        aria-activedescendant={active() ? optionId(active()!.key) : undefined}
                        placeholder="Search tickets, documents and projects"
                        autocomplete="off"
                        spellcheck={false}
                        maxlength={MAX_QUERY}
                        value={query()}
                        onInput={(event) => setQuery(event.currentTarget.value)}
                    />
                    <div id={listId} class="palette__list" role="listbox" aria-label="Results">
                        <For each={groups()} keyed={(group) => group.kind}>
                            {(group) => (
                                <div class="palette__group" role="group" aria-label={group().heading}>
                                    <div class="palette__heading t-meta" aria-hidden="true">
                                        {group().heading}
                                    </div>
                                    <For each={group().rows} keyed={(row) => row.key}>
                                        {(row) => (
                                            <div
                                                id={optionId(row().key)}
                                                class={`palette__option${active()?.key === row().key ? ' palette__option--active' : ''}`}
                                                role="option"
                                                aria-selected={active()?.key === row().key ? 'true' : 'false'}
                                                onMouseMove={() => setActiveKey(row().key)}
                                                onClick={() => openRow(row())}
                                            >
                                                <span class="palette__label t-body">
                                                    <Pieces pieces={row().label} />
                                                </span>
                                                <Show when={row().note}>
                                                    <span class="palette__note t-meta">{row().note}</span>
                                                </Show>
                                                <Show when={row().field || row().detail.length > 0}>
                                                    <span class="palette__detail t-meta">
                                                        <Show when={row().field}>
                                                            <span class="palette__field">{`${row().field}: `}</span>
                                                        </Show>
                                                        <Pieces pieces={row().detail} />
                                                    </span>
                                                </Show>
                                            </div>
                                        )}
                                    </For>
                                </div>
                            )}
                        </For>
                    </div>
                    <p class="palette__status t-meta" role="status">
                        {status()}
                    </p>
                </div>
            </div>
        </Portal>
    )
}
