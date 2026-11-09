# ADR 0004: The Cognito app client is confidential (server-held secret) and also uses PKCE

- Status: Accepted
- Date: 2026-11-09

## Context

Build guide Step 1.9 asks for a decision: _"No client secret for the public web flow, or a client secret held only on the server. Decide and record it in an ADR."_

Chatlium's design (decision record §2, amendments §2) already exchanges the authorization code **on the server**, in the Next.js route `/api/auth/callback`, and keeps tokens out of the browser. The browser never needs to talk to the token endpoint.

## Decision

The app client `chatlium-web` is a **confidential client**: `GenerateSecret = true`. The secret lives only in server-side configuration (`COGNITO_CLIENT_SECRET`: `.env` locally, Secrets Manager in AWS) and is sent only from the server to the token endpoint, with HTTP Basic authentication. **PKCE (S256) is used as well**, together with `state` and `nonce`.

Other client settings (guide Step 1.9 and amendments §2):

- Authorization code grant only (`AllowedOAuthFlows = ["code"]`), scopes `openid email profile`, identity provider `COGNITO`.
- Callback `http://localhost:3000/api/auth/callback`, logout `http://localhost:3000/` (exact match).
- Access and ID tokens last 15 minutes, refresh tokens 7 days. Token revocation is on.
- `PreventUserExistenceErrors = ENABLED`, so sign-in errors do not reveal whether an account exists.
- The pool uses email as the username, requires a password of 12+ characters with upper, lower, number and symbol, has MFA optional (TOTP), and allows admin-created users only.

## Why

- **Defense in depth.** A stolen authorization code is useless without both the PKCE verifier (held in a sealed, short-lived cookie) and the client secret (held only on the server). The OAuth 2.0 Security Best Current Practice (RFC 9700) recommends PKCE for confidential clients too.
- **Nothing is lost by having a secret.** A public client is needed only when the browser or a mobile app redeems the code itself, and Chatlium never does that.
- **Refresh tokens are server-only**, consistent with "tokens refreshed on the server".

## Consequences

- `COGNITO_CLIENT_SECRET` joins the server-only secrets (Secrets Manager in Phase 4). It must never reach the widget or the browser bundle.
- Locally, `pnpm --filter @chatlium/dev-tools cognito:setup` creates the pool, client and two test users in Floci (idempotent) and writes the IDs, the secret and random test passwords to `.env`. `cognito:check` walks the hosted sign-in flow end to end.
- In Phase 4 the pool and client move to Terraform with the same settings. Floci's sign-in pages are simpler than AWS's (no sign-up, MFA or forgot-password pages), so those are checked against a real pool before Phase 7.
