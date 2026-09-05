# LaminarFlow — Frontend

React + TypeScript + Vite. Built with `npm run build` into `dist/`.

## Same-origin deployment

In production the Go backend serves this bundle **and** the API from one origin
(LAM-28) — there is no separate frontend host. Application code should therefore
always use relative URLs (`fetch('/api/...')`), never an absolute backend URL.

`npm run dev` is the one place that is not literally true: Vite serves the app on
5173 while the backend listens on 8080. `vite.config.ts` proxies `/api` and
`/healthz` across so relative URLs work in dev too. Point `VITE_API_TARGET` at a
different backend if yours is not on 8080.

To see this repo's build served by the backend the way production does it, run
`./scripts/build-frontend.sh` in the backend repo.

## Template notes

Inherited from the Vite React+TS template, kept for reference.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
