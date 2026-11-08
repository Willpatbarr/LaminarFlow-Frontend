import type { JSX } from '@solidjs/web'
import { Show } from 'solid-js'

import './ListBar.css'

/*
┌─ ui ────────────────────────────────────────────
│  ListBar: one item of a list, as a chip-style bar (LAM-201)
├─ out ───────────────────────────────────────────
│      ListBar    <ListBar href={…} title="…" meta={<><MetaChip>…</MetaChip></>} />
│      MetaChip   <MetaChip>Team-wide</MetaChip>   - a small neutral pill for a fact about the item
├─ example ───────────────────────────────────────
│      Documents, Epics, Sprints, Milestones, a team's projects, Views, Settings' teams
*/
// Will's decision (2026-11-02): the lists of things you open (documents, epics,
// views, ...) are rounded bars on a surface, not underlined links, and not the
// 34px Table Row of the vault either. The whole bar is the link: the title is
// an <a>, stretched over the bar, so the accessible name stays the title alone
// and the facts beside it (the chips) are described by nothing and read as text.
// The chips sit on the right; on a narrow screen they wrap under the title.
//
// Anything that must stay clickable on its own (a Delete button, a second link)
// goes in `actions`, which sits above the stretched link.
type ListBarProps = {
    /** The destination. Omit for a bar that is not itself a link (the title is then plain text). */
    href?: string
    title: JSX.Element
    /** A quieter line under the title. */
    subtitle?: JSX.Element
    /** Chips: facts about the item. */
    meta?: JSX.Element
    /** Buttons or links of their own. */
    actions?: JSX.Element
    /** A full-width row under everything (a progress bar). */
    below?: JSX.Element
    /** Attributes and handlers for the bar itself: a list that lets its bars be dragged. */
    rowProps?: JSX.HTMLAttributes<HTMLLIElement>
}

export function ListBar(props: ListBarProps) {
    return (
        <li class="list-bar" {...props.rowProps}>
            <div class="list-bar__text">
                <Show when={props.href} fallback={<span class="list-bar__title t-body">{props.title}</span>}>
                    {(href) => (
                        <a class="list-bar__title list-bar__link t-body" href={href()}>
                            {props.title}
                        </a>
                    )}
                </Show>
                <Show when={props.subtitle}>
                    <span class="list-bar__subtitle t-meta">{props.subtitle}</span>
                </Show>
            </div>
            <Show when={props.meta}>
                <span class="list-bar__meta">{props.meta}</span>
            </Show>
            <Show when={props.actions}>
                <span class="list-bar__actions">{props.actions}</span>
            </Show>
            <Show when={props.below}>
                <div class="list-bar__below">{props.below}</div>
            </Show>
        </li>
    )
}

/** The list the bars sit in. */
export function ListBars(props: { label?: string; children: JSX.Element }) {
    return (
        <ul class="list-bars" aria-label={props.label}>
            {props.children}
        </ul>
    )
}

/** A small neutral pill: a fact about an item that is not a status or a label. */
export function MetaChip(props: { children: JSX.Element }) {
    return <span class="chip meta-chip">{props.children}</span>
}
