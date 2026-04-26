# Glass Claim Assessment System

Fresh scaffold for the Phase 1 windscreen-only claim assessment pilot. The authoritative requirements are in `.kiro/specs/glass-claim-assessment/`.

## Stack Choice

The specs prescribe TypeScript/Node.js, React/TypeScript, PostgreSQL 17, REST APIs with OpenAPI documentation, and fast-check for property-based tests. This scaffold follows that direction and uses:

- npm workspaces for a small monorepo with API, web, and shared packages.
- Fastify for the Node API because it is TypeScript-friendly and has mature OpenAPI, security, and rate-limit plugins.
- Vite for the React/TypeScript PWA shell because it keeps the frontend scaffold lightweight.
- PostgreSQL 17 for local persistence parity with the required `glass_claims_db` and `glass_user`.
- Vitest plus fast-check-ready tooling for later unit and property tests.

No feature or claim-processing business logic is implemented yet.

## Repository Layout

```text
apps/
  api/        Node.js REST API scaffold
  web/        React/TypeScript PWA scaffold
packages/
  shared/     Shared TypeScript package placeholder
db/
  migrations/ Future PostgreSQL migrations
  seeds/      Future development seed data
docs/         Project notes outside the Kiro specs
infra/        Local infrastructure helpers
```

## Useful Scripts

```bash
npm run dev:api
npm run dev:web
npm run typecheck
npm run lint
npm test
npm run build
```

The current Codex shell has Node available but not npm, so dependency installation and npm-backed verification need to run in an environment with npm on PATH.

## Local Configuration

Copy `.env.example` to `.env` and replace placeholder values. Do not commit real credentials or carrier data.
