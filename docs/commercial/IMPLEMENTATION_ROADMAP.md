# Commercial MVP Implementation Roadmap

Status: **Phase 0 — in progress. No commercial application code changed yet.** Sequence is conditional on the completed source audit and architecture review; credentials are intentionally not assumed.

## Phase 0 — Discovery and audit

**Objectives:** establish source-of-truth architecture, preserve user functionality, record security/licensing risks, choose modular monolith boundaries, define requirements, model and credit invariants.

**Deliverables:** the seven documents under `docs/commercial/`, plus root `AGENTS.md` permanent project rules.

**Acceptance criteria:** all listed repository domains inspected; evidence-linked findings; exact package commands/baseline results; roadmap and test plan; no code changes before documentation gate.

**Tests:** `pnpm type`, `pnpm lint`, `pnpm build` baseline. There is no root test script today.

**Risks:** legacy AGPL/GPL obligations, jailbreak product/policy restrictions, static-only deployment, and owner/business decisions for merchant jurisdiction, plan catalog and retention.

**Completion:** In progress.

## Phase 1 — Backend and foundations

**Objectives:** choose Node server runtime compatible with the existing static client and SSE; PostgreSQL and migration workflow; maintained auth; secure sessions; user/admin authorization; health and typed contracts.

**Likely boundaries:** server package/routes, database schema/migrations/repositories, auth config/session guards, environment validation, generated types, integration test harness. Exact paths depend on selected server framework and existing hosting constraints; do not add an unsupported backend folder/package before deciding runtime compatibility.

**Acceptance criteria:** registration/login/logout/recovery/verification and role checks work in controlled tests; every protected route derives user identity from session; ownership and admin-denial tests pass; migrations apply on disposable PostgreSQL; no secrets in frontend bundle.

**Tests:** unit auth/domain, integration identity and user-isolation, migration test; lint/typecheck/build.

**Risks:** static-only GitHub Pages cannot host server routes; Vercel framework/runtime/SSE/PostgreSQL connectivity must be verified. Email and OAuth require configured provider accounts.

**Status:** In progress. Implemented the Vercel-compatible foundation plus Better Auth route wiring, Neon-compatible pooled `pg` runtime access, initial auth migration, `/api/me`, migration script, and separate API/Rspack TypeScript checks. A Vercel Preview deployment was created and `/api/health` was verified successfully. Neon and `AUTH_SECRET` are now configured in Vercel, and the runtime reaches the database. Drizzle ORM is now the canonical database layer, with typed auth/profile schema definitions, the Better Auth Drizzle adapter, generated migrations, and a Drizzle migration runner. The generated baseline migration is applied to the linked Preview Neon database. Resend is now configured for Preview and Production, and Preview `APP_ORIGIN` points to the temporary verified domain. A real mailbox signup/verification flow still needs to be exercised before treating email delivery as verified.

## Phase 2 — Billing and credit engine

**Objectives:** configurable plan catalog, Stripe Checkout/Portal, webhook lifecycle synchronization, immutable ledger, grants, reservations, settlement, release, refunds and reconciliation.

**Acceptance criteria:** duplicate/misordered webhook deliveries are safe; plan lifecycle updates are idempotent; monthly grant occurs exactly once; ledger is append-only; concurrent reservations cannot overdraw; admin adjustments are audited.

**Tests:** pricing/entitlement/state-transition unit tests; signed webhook and duplicate integration tests; concurrent reservation and replay tests. Stripe test mode only; production payment tests require operator approval.

**Risks:** business-defined credit units/prices, tax/merchant jurisdiction, proration/downgrade behavior, refund and grace-period policy remain explicit product decisions/configuration.

**Status:** Not started.

## Phase 3 — Runpod and DeepSeek

**Objectives:** registry and pricing snapshots; provider-neutral interface; Runpod adapter and DeepSeek model adapter; authenticated SSE gateway; normalized usage; credit settlement and recovery.

**Acceptance criteria:** arbitrary provider IDs/URLs rejected; no Runpod secret in browser; stream reaches the existing response UI; usage and settlement are server-authoritative; provider failure, partial completion and disconnect follow documented policy; reconciler recovers stale jobs.

**Tests:** normalized adapter tests, fake-provider streaming integration suite, no-credit/unentitled/provider-failure/idempotency/disconnect/concurrency/reconciliation tests. Live Runpod job only after an operator supplies sandbox credentials/endpoint configuration and approves any charges.

**Risks:** actual worker/engine streaming protocol, usage metadata and cancellation semantics must be verified against the deployed worker; Runpod endpoint operation can incur costs.

**Status:** Not started.

## Phase 4 — Frontend integration

**Objectives:** use authenticated gateway for paid requests; add signup/account/pricing/billing/usage views; display credits and entitlement errors; import legacy local conversations only with user consent.

**Acceptance criteria:** retain existing message rendering, stream parser, branching, markdown, i18n, mobile behavior and local-only capabilities; no account sees another account's conversation; local legacy data is neither silently uploaded nor overwritten.

**Tests:** component/browser tests for critical chat rendering and account flows; E2E registration → simulated/test checkout webhook → generation → deduction → usage → cancel. Verify responsive mobile/Android behavior for supported scope.

**Risks:** current client has many local-only features and local settings; commercial and local modes must not share authority accidentally.

**Status:** Not started.

## Phase 5 — Admin and production readiness

**Objectives:** admin operational UI, plan/model operations, audited adjustments/suspension, health/metrics, deployment and incident/reconciliation runbooks, independent review and legal review.

**Acceptance criteria:** admin functions server-protected/audited; no credential/content leakage; backup/restore/deletion and stuck-credit recovery documented and tested; licensing and terms/privacy approvals completed; full build/type/lint/tests pass; deployment configuration validated in sandbox.

**Tests:** E2E admin authorization, failure/reconciliation tests, security and dependency/licensing scans, release review. Production/real customer data checks require explicit approval.

**Risks:** no operational scale/cost target supplied; define rate limits, observability retention and service objectives before launch.

**Status:** Not started.

## Prioritized backlog

1. Complete audit evidence and root engineering rules; record baseline checks.
2. Decide deployment/runtime and auth/database framework after verifying connected Vercel capability; create architecture decision record.
3. Create PostgreSQL schema/migrations and auth with tenant ownership tests.
4. Implement configurable plans + webhook idempotency.
5. Build integer credit ledger and concurrency/reconciliation tests before any paid inference.
6. Build fake-provider gateway and SSE contract, then Runpod/DeepSeek adapter once worker protocol is verified.
7. Add frontend commercial account/billing/credits while preserving chat behavior.
8. Add admin/audit/operations, complete license/privacy review and sandbox E2E.

## Phase exit reporting

A phase is complete only when its acceptance criteria and actual tests pass. Missing credentials, unavailable infrastructure, existing baseline failures, or incomplete security/legal approvals remain explicit blockers; documentation or a mock test is not evidence of a live third-party integration.
