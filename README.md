# LaminarFlow — Frontend

React + TypeScript + Vite. Built with `npm run build` into `dist/`.

The Go API, schema, and migrations live in
[LaminarFlow-Backend](https://github.com/Willpatbarr/LaminarFlow-Backend).

## Same-origin deployment

In production the Go backend serves this bundle **and** the API from one origin
(LAM-28) — there is no separate frontend host. Application code should therefore
always use relative URLs (`fetch('/api/...')`), never an absolute backend URL.

`npm run dev` is the one place that is not literally true: Vite serves the app on
5173 while the backend listens on 8080. `vite.config.ts` proxies `/api` and
`/healthz` across so relative URLs work in dev too. Point `VITE_API_TARGET` at a
different backend if yours is not on 8080.

## Running it

Node is pinned in [.nvmrc](.nvmrc) — `nvm use` picks it up, and CI reads the
same file, so local and CI cannot drift.

    npm ci
    npm run dev

## Checks

`npm run build` type-checks with `tsc -b` before Vite emits the bundle, so a
type error fails the build rather than shipping.

    npm run lint
    npm test
    npm run test:e2e
    npm run build

## Where components live

| Path | What belongs there |
| --- | --- |
| `src/routes/` | One file per URL. Thin — imports feature components, lays them out. |
| `src/features/<name>/` | One domain feature: its components, API calls, and state. |
| `src/components/ui/` | Domain-agnostic ui blocks used by more than one feature. |
| `e2e/` | Playwright specs — one per user-visible flow, not per component. |

Imports run one way — `routes/` → `features/` → `components/` — and **nothing
enforces it**. React has no compile-time module boundary the way Gradle modules
do in Kotlin, so a cross-feature import compiles happily. If that starts
happening, an import lint rule is the fix; there is deliberately none today.

## This repo never talks to Postgres

[scripts/check-no-db-driver.mjs](scripts/check-no-db-driver.mjs) fails
`npm run lint` if a database driver reaches the dependency tree. Every read and
write goes through the backend's HTTP API.

To see this repo's build served by the backend the way production does it, run
`./scripts/build-frontend.sh` in the backend repo.