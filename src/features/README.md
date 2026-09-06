# Features

One folder per domain feature — `tickets/`, `documents/`, `aspects/`,
`comments/` — each holding everything that feature needs:

    tickets/
      components/   the feature's own UI
      api/          its calls to the backend
      state/        local state that only this feature cares about

A feature imports from `@/components`. It does not import from another feature:
if two features need the same thing, that thing is shared and moves.