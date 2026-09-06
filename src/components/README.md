# Shared components

Domain-agnostic building blocks — buttons, modals, inputs, spinners.

**The rule of thumb.** A component belongs here if more than one feature uses
it, or if it knows nothing about the domain. It belongs in a feature folder if
it is specific to that feature: a Kanban card, a comment thread view.

Imports run one way. `features/` may import from here; nothing here may import
from `features/`. A shared component that needs a ticket type is not shared.