# Build log

## Commitments (Step 0.3)

- Weekly hours available: skipped by the owner (2026-11-07)
- Total duration: skipped by the owner (2026-11-07)
- Monthly AWS ceiling: ___ (deferred to Phase 4: development is local-only with Floci until then; working target $50–100)

Step 0.3 was skipped by the owner, so the phases have no time limits. Actual time per phase is still recorded here, and limits can be added later.

## Entries

Each entry: date, step, what was done, what surprised us, time taken.

### 2026-11-05 to 2026-11-07: Phase 0 preparation

**0.1 Decision record for Cognito.** Already satisfied. Both decision files commit to Cognito, and Better Auth appears only as the rejected alternative. Two conflicts between the decision files and the guide were resolved by the owner and written into both (`usage_status` = `unknown`; in-process queue adapter for unit tests).

**0.2 Tooling.** Versions installed on 2026-11-07:

| Tool          | Version                                   |
| ------------- | ----------------------------------------- |
| Git           | 2.49.0                                    |
| Node.js       | 26.13.0 (system-wide, replaced 22.15.1)   |
| npm           | 11.20.0                                   |
| pnpm          | 12.18.0                                   |
| Docker Engine | 29.9.2 (Docker Desktop)                   |
| AWS CLI       | 2.36.29                                   |
| Terraform     | 1.12.2 (upgrade to 1.17.1 before Phase 4) |
| kubectl       | 1.36.2                                    |
| Helm          | 4.2.1 (upgrade to 4.3.1 before Phase 5)   |
| GitHub CLI    | 2.103.3                                   |
| Floci         | 2.4.0 (Docker image)                      |
| k6            | not installed yet (Phase 6)               |

`docker run hello-world` succeeded on 2026-11-07.

Surprises:

- Corepack is no longer bundled with Node 26, so pnpm is installed globally with npm.
- typescript-eslint does not support TypeScript 7, so we use oxlint with tsgolint.
- An old Floci 1.7.0 setup and old Chatlium containers, volumes and images were removed. Floci 2.4.0 was pulled fresh and smoke-tested: FIFO dedup, Cognito discovery with PKCE S256, S3 versioning and Secrets Manager all work.
- The Claude app's terminal tabs keep the PATH from when the app started, so newly installed tools need an app restart.

**0.4 Accounts.** GitHub CLI is logged in as SaadIrfan41. The existing private repo `chatlium` holds an older, unrelated build and is left untouched. The greenfield repo is `chatlium-cloud`. The AWS account and budget alerts are deferred to Phase 4. A Gemini API key is needed by Step 2.5.

**0.5 Repository skeleton (2026-11-07).** Created the README, ADR 0001, this log, the PR template, `.gitignore`, `.editorconfig` and `.gitattributes`, and added the decision files, guide, research and project skills. Initial commit `f8cafd6` was pushed to the new private repo https://github.com/SaadIrfan41/chatlium-cloud (`main`).

Surprises:

- **Branch protection was blocked on the private repo:** GitHub returned HTTP 403 "Upgrade to GitHub Pro or make this repository public". The owner chose to **make the repository public**.
- Before going public, commits were switched to GitHub's noreply address so the personal email is not published. This repo's `user.email` is `75434031+SaadIrfan41@users.noreply.github.com`, and the single initial commit was rewritten and force-pushed.
- The guide's "one approval, self-approve if alone" does not work on GitHub, which never lets a PR author approve their own PR. Protection is set to require a pull request with **0 approvals**. Required CI status checks become the merge gate in Step 1.13.

Protection on `main`: pull request required, applied to admins too, stale reviews dismissed, conversations must be resolved, no force pushes, no deletion.

### 2026-11-07: Phase 1 — Foundation and tenant isolation

**1.1 Initialize the monorepo.** Root `package.json` (`private`, `packageManager: pnpm@12.18.0`, `engines` Node 26 / pnpm 12), `pnpm-workspace.yaml` (`apps/*`, `packages/*`), Turborepo 2.11.10 with `build`, `lint`, `typecheck` and `test` tasks, and `packages/tsconfig` with a strict base config (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `es2025`, `nodenext`). Lint uses oxlint with `--type-aware` (tsgolint) and one root `.oxlintrc.json`. Formatting uses Prettier. Pinned: typescript 7.0.2, oxlint 1.91.0, oxlint-tsgolint 7.0.2006, prettier 3.9.10.

Done-when evidence (empty workspace): `pnpm install --frozen-lockfile`, `pnpm lint` and `pnpm typecheck` all exit 0. `pnpm format:check` passes.

Proof that the checks are not passing for the wrong reason: a temporary package with a deliberate `number | undefined` assignment, a floating promise and a `console.log` was added. `typecheck` failed with TS2322, `lint` failed with `typescript(no-floating-promises)` and `no-console` (from the root config, read from inside the package). After the code was fixed both passed. The probe package was then deleted.

Surprises:

- **pnpm 12 has a supply-chain release-age delay.** Installing oxlint 1.92.0, published about 7 hours earlier, made pnpm write `minimumReleaseAgeExclude` entries for it into `pnpm-workspace.yaml`. Owner decision: pin **oxlint 1.91.0** (2026-11-03), which passes the delay, and keep no exceptions. Policy: we do not add release-age exceptions; Renovate (Step 1.13) proposes newer versions once they age.
- Turborepo's `transit` task pattern lets `lint` and `typecheck` run in parallel while still re-running when an internal dependency changes.
- Turborepo prints "No tasks were executed" on the empty workspace and exits 0. This is expected until packages with scripts exist.
