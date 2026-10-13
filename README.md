# LaminarFlow — Frontend

Solid + TypeScript + Vite. Built with `npm run build` into `dist/`.

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

## Consuming the API

    npm run api:pull

Fetches `api/openapi.json` from the backend's `main` and regenerates
`src/api/schema.d.ts`. Both are committed. Pass `API_REF=<branch>` to pull from
a branch that has not merged yet.

Calls go through `src/api/client.ts`, which is typed from the generated schema:
a path or field the backend does not have is a build error, not a 404.

## Routing

The route tree is declared in [src/router.tsx](src/router.tsx) with
`defineRoutes` from `@solidjs/router` — config routes, not the file-system
adapter. `defineRoutes` keeps the path literals, and those literals are what
type `router.paths`: a path the tree does not have is a compile error, not a
404.

The file-system adapter (`@solidjs/router/fs`) would generate the tree from
`src/routes/`, but its manifest needs a build step that ships with the Solid
CLI templates and SolidStart, and neither is installed here. Two routes do not
justify the integration. **Revisit when the route tree grows.**

Solid Router has no link component. Links are plain `<a href>` and the router
intercepts the click; it also sets `aria-current="page"` on the one matching the
URL.

### Protected routes

`/login` and `/signup` stand alone. Every other route is a child of the
pathless `AppLayout` (`routes/app.tsx`), which is the auth guard and the app
shell in one - so a route added under it is protected without having to
remember to be. Anonymous visitors are sent to `/login?returnTo=<where they
were going>`; `returnTo` passes through `safeReturnTo`
(`features/auth/returnTo.ts`), the only place it is trusted, and anything that
is not a same-origin path becomes `/`. While the session is still `unknown` the
shell renders with a placeholder rather than redirecting.

`createAppRouter(history?)` builds the real tree on any history adapter, which
is how the route tests start it at a given URL.

## Where components live

| Path | What belongs there |
| --- | --- |
| `src/routes/` | One file per URL. Thin — imports feature components, lays them out. |
| `src/features/<name>/` | One domain feature: its components, API calls, and state. |
| `src/components/ui/` | Domain-agnostic ui blocks used by more than one feature. |
| `e2e/` | Playwright specs — one per user-visible flow, not per component. |

Imports run one way — `routes/` → `features/` → `components/` — and **nothing
enforces it**. Solid has no compile-time module boundary the way Gradle modules
do in Kotlin, so a cross-feature import compiles happily. If that starts
happening, an import lint rule is the fix; there is deliberately none today.

## This repo never talks to Postgres

[scripts/check-no-db-driver.mjs](scripts/check-no-db-driver.mjs) fails
`npm run lint` if a database driver reaches the dependency tree. Every read and
write goes through the backend's HTTP API.

To see this repo's build served by the backend the way production does it, run
`./scripts/build-frontend.sh` in the backend repo.