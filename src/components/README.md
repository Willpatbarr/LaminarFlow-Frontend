# Shared components

Domain-agnostic building blocks — buttons, modals, inputs, spinners.

**The rule of thumb.** A component belongs here if more than one feature uses
it, or if it knows nothing about the domain. It belongs in a feature folder if
it is specific to that feature: a Kanban card, a comment thread view.

Imports run one way. `features/` may import from here; nothing here may import
from `features/`. A shared component that needs a ticket type is not shared.

**One sharp edge of the pinned Solid RC.** The compiler (rc.8) wraps a dynamic
`class` or `style` in a `readShallow` helper that the runtime (rc.7) does not
export, and the app crashes at render. Template literals and object literals
are not wrapped, so write ``class={`a${on ? ' b' : ''}`}`` and
`style={{ … }}`, never `class={on ? 'a b' : 'a'}`.

**Loading states.** Skeleton-ability is a trait of the container, not a sibling
component. A new container component is not done without its loading state: it
takes `loading` and draws its own placeholder in its own layout, because it is
the only thing that knows where its title and its status badge sit. Nothing
passes a skeleton in from outside and there is no `<ListSkeleton />` beside the
list. `Skeleton.tsx` holds the building blocks (`SkeletonLine`, `SkeletonBox`,
`SkeletonCircle`); they know nothing about the domain.

    export function TicketRow(props: TicketRowProps) {
        return (
            <Show when={loaded(props)} fallback={
                <TableRow loading>                                {/* the real row's box */}
                    <span><SkeletonLine width="60%" height="13px" /></span>
                    <span><SkeletonBox shape="pill" width="72px" height="21px" /></span>
                    <SkeletonCircle size="20px" />
                </TableRow>
            }>
                {(row) => <TableRow href={`/tickets/${row().ticket.id}`}>…</TableRow>}
            </Show>
        )
    }

The rules that make it work:

- **Same box.** The placeholder uses the real thing's wrapper and classes (here
  `TableRow`, so the same height and grid), with a bar where text goes and a
  shape of the right size where a badge or avatar goes. Nothing may move when
  the data arrives. Assert it in the test: same wrapper class, same number of
  cells.
- **The container announces, the primitives do not.** Every primitive is
  `aria-hidden`. The container carries `aria-busy="true"` and exactly one
  visually hidden `role="status"` message ("Loading tickets…"), outside the
  hidden placeholder. Keep to one per region: the side nav has its own, and
  several tests expect exactly one inside `<main>`.
- **No real content.** A placeholder shows no data, no links, nothing to
  activate. A control that will exist anyway (the page heading, a "New ticket"
  button) may stay, disabled, so it does not appear later.
- **Lengths have units.** Sizes are CSS length strings (`"60%"`, `"9ch"`,
  `"20px"`); a bare number is a type error.
- **Motion is opt-in.** The shimmer runs only under
  `prefers-reduced-motion: no-preference`; otherwise it is a static tint.
- **Real state, no staging.** `loading` is wired to something true (the first
  hydration, an unknown session), never to a timer. There is no minimum display
  time, and a warm local database must not flash a skeleton over data it
  already has.

`AppShell` is exempt: it is a frame (rail, banners, toasts, main) with no
content of its own, and what fills those slots draws its own loading state.
Notices (banners, toasts, the conflict panel) are not loading states and are
not skeletons.
