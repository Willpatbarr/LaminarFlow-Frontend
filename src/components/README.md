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
