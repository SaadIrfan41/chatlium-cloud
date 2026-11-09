# Chatlium

Chatlium is a multi-tenant AI support chat platform. Businesses upload their documents, embed a chat widget on their website, and visitors get grounded, streamed answers, with escalation to a human operator when the AI is not confident.
The project is a cloud and DevOps portfolio build: it is developed locally against emulated AWS (Floci), then deployed to AWS with Terraform, EKS and GitOps, with tenant isolation, reliability and cost measured and evidenced at every step.

## Status

Phase 1 (foundation and tenant isolation). Progress is recorded in [docs/build-log.md](docs/build-log.md).

## Local development

Requires Node 26, pnpm 12 and Docker.

```bash
cp .env.example .env        # then set a password in .env
pnpm install
docker compose up -d --wait # PostgreSQL 18 + pgvector, Redis 8, Floci (local AWS)
pnpm --filter @chatlium/db db:bootstrap            # database roles (once)
pnpm --filter @chatlium/db db:migrate              # schema and row-level security
pnpm --filter @chatlium/dev-tools cognito:setup    # Cognito user pool + test users in Floci
pnpm lint && pnpm typecheck && pnpm test
```

## Documentation

- [Build guide](docs/build-guide.md): phase-by-phase plan
- [Decision records](docs/decisions/): authoritative architecture decisions (amendments > decisions > guide)
- [ADRs](docs/adr/): decisions made during the build
- [Version research](docs/research/2026-11-06-versions-and-floci.md): pinned versions and Floci notes
