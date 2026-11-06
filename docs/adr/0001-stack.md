# ADR 0001: Technology stack

- Status: Accepted
- Date: 2026-11-07

## Context

Chatlium is built from scratch (greenfield). The stack was decided before the build started and is recorded in three decision files.

## Decision

The stack is the one defined in:

1. [chatlium-greenfield-decisions.md](../decisions/chatlium-greenfield-decisions.md): the base decision record.
2. [chatlium-greenfield-amendments.md](../decisions/chatlium-greenfield-amendments.md): wins over the decision record where they differ.
3. [chatlium-usage-observability.md](../decisions/chatlium-usage-observability.md): usage tracking and observability addendum.

Precedence: amendments > decisions > build guide.

### Pinned choices made at the start of the build

These choices follow the decision files and record versions and tools that the files leave open. Details and sources: [version research](../research/2026-11-06-versions-and-floci.md).

| Area | Choice | Why |
|---|---|---|
| Runtime | Node.js 26.13.0 (current LTS), installed system-wide, pinned in `.nvmrc` | Decisions: "Node.js current LTS". Owner chose a single global Node over a version manager |
| Package manager | pnpm 12.18.0, pinned through `packageManager` | Corepack is no longer bundled with Node 26 |
| Language | TypeScript 7.0.2 (strict) | Owner chose the latest TypeScript |
| Linting | oxlint with `oxlint-tsgolint` for type-aware rules. Prettier for formatting | typescript-eslint supports only TypeScript < 6.1 |
| Local AWS | Floci 2.4.0 (SQS, S3, Secrets Manager, KMS, Cognito) | Passed FIFO dedup and Cognito PKCE checks. Development is local-only until Phase 4 |
| Local database | `pgvector/pgvector` on PostgreSQL 18, as a plain container | pgvector is needed from the first migration |
| Tenant context | `set_config('app.workspace_id', $1, true)` | Transaction-local like `SET LOCAL` (amendments §4), but accepts a bind parameter |
| Usage status | `reported`, `estimated`, `unknown` | Owner decision, 2026-11-06 |
| Test queue | In-process `MessageQueue` adapter for unit tests. SQS adapter on Floci from Phase 3 | Owner decision, 2026-11-06 |

## Consequences

- Each phase pins exact versions when it installs them and checks them against current documentation.
- Lint rules from the typescript-eslint ecosystem are not available. Revisit when typescript-eslint supports TypeScript 7.
- Any change to a decision above needs a new ADR that supersedes this one.
