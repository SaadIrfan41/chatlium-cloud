# Build log

## Commitments (Step 0.3)

- Weekly hours available: ___ (to be set by the owner)
- Total duration: ___ (to be set by the owner)
- Monthly AWS ceiling: ___ (deferred to Phase 4: development is local-only with Floci until then; working target $50–100)

Phase time limits are filled in the [build guide's phase tracker](build-guide.md#phase-tracker) once the numbers above are set.

## Entries

Each entry: date, step, what was done, what surprised us, time taken.

### 2026-11-05 to 2026-11-07: Phase 0 preparation

**0.1 Decision record for Cognito.** Already satisfied. Both decision files commit to Cognito, and Better Auth appears only as the rejected alternative. Two conflicts between the decision files and the guide were resolved by the owner and written into both (`usage_status` = `unknown`; in-process queue adapter for unit tests).

**0.2 Tooling.** Versions installed on 2026-11-07:

| Tool | Version |
|---|---|
| Git | 2.49.0 |
| Node.js | 26.13.0 (system-wide, replaced 22.15.1) |
| npm | 11.20.0 |
| pnpm | 12.18.0 |
| Docker Engine | 29.9.2 (Docker Desktop) |
| AWS CLI | 2.36.29 |
| Terraform | 1.12.2 (upgrade to 1.17.1 before Phase 4) |
| kubectl | 1.36.2 |
| Helm | 4.2.1 (upgrade to 4.3.1 before Phase 5) |
| GitHub CLI | 2.103.3 |
| Floci | 2.4.0 (Docker image) |
| k6 | not installed yet (Phase 6) |

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
