import { createContext, Show, useContext } from 'solid-js'
import { Portal, type JSX } from '@solidjs/web'

import './PageLayout.css'

/*
┌─ ui ────────────────────────────────────────────
│  PageLayout: the one frame every page sits in (LAM-201)
├─ out ───────────────────────────────────────────
│      PageLayout   <PageLayout title={…} rail={…} size="wide">body</PageLayout>
│      PageActions  <PageActions>buttons</PageActions>   - from anywhere inside a PageLayout
│      PageSubnav   <PageSubnav>tabs, a view switch</PageSubnav>
│      PageRail     <PageRail>the document's Actions panel</PageRail>
├─ example ───────────────────────────────────────
│      title on the left, actions at the window's right edge, the body centred
│      under them at --page-max, and an optional rail at the right edge
*/
// Before this, every page set its own max-width, so content sat against the
// sidebar with empty space on the right. Now the header bar spans the whole
// content area (title left, actions right) and the body is centred beneath it,
// at the width the page asks for: "default" (--page-max), "reading" (--page-max-reading,
// for text you read) or "wide" (the whole width, for the Board). The optional
// rail (the document's Actions panel) sits at the right edge, beside the
// centred body when there is room and below it when there is not.
//
// A component deep in the page (a list that owns its buttons) puts them in the
// header with <PageActions> / <PageSubnav>, the header's two slots, instead of
// handing them up as props:
// the two slots are elements made here and portalled into, so there is no
// signal to write while rendering.

type Slots = { actions: HTMLElement; subnav: HTMLElement; rail: HTMLElement }

const PageContext = createContext<Slots | null>(null)

export type PageSize = 'default' | 'reading' | 'wide'

type PageLayoutProps = {
    /** Left of the header: a back link, the heading. Without one the page has no header bar. */
    title?: JSX.Element
    size?: PageSize
    children: JSX.Element
}

export function PageLayout(props: PageLayoutProps) {
    const actions = document.createElement('div')
    actions.className = 'page__actions'
    const subnav = document.createElement('div')
    subnav.className = 'page__subnav'
    // A plain box: the <aside> is PageRail's, so a page with no rail has no empty landmark.
    const rail = document.createElement('div')
    rail.className = 'page__rail'
    return (
        <PageContext value={{ actions, subnav, rail }}>
            <div class={`page page--${props.size ?? 'default'}`}>
                {/* A page with no title has no header bar (and nowhere for PageActions to go). */}
                <Show when={props.title}>
                    {(title) => (
                        <header class="page__header">
                            <div class="page__title">
                                {title()}
                                {subnav}
                            </div>
                            {actions}
                        </header>
                    )}
                </Show>
                <div class="page__main">
                    <div class="page__body">{props.children}</div>
                    {rail}
                </div>
            </div>
        </PageContext>
    )
}

/** Buttons for the page header's right end, from anywhere inside a PageLayout.
 *  Outside one (a unit test of a single component) they stay where they are. */
export function PageActions(props: { children: JSX.Element }) {
    const slots = useContext(PageContext)
    return slots ? <Portal mount={slots.actions}>{props.children}</Portal> : <>{props.children}</>
}

/** The column at the window's right edge, from anywhere inside a PageLayout. It
 *  drops under the body when the page is too narrow to hold it beside. */
export function PageRail(props: { label: string; children: JSX.Element }) {
    const slots = useContext(PageContext)
    const side = () => <aside aria-label={props.label}>{props.children}</aside>
    return slots ? <Portal mount={slots.rail}>{side()}</Portal> : side()
}

/** The row under the title, from anywhere inside a PageLayout. */
export function PageSubnav(props: { children: JSX.Element }) {
    const slots = useContext(PageContext)
    return slots ? <Portal mount={slots.subnav}>{props.children}</Portal> : <>{props.children}</>
}
