# Permanent Engineering Rules

## Product direction

- Product is a commercial AI chat SaaS launching with one server-hosted DeepSeek model via Runpod Serverless. Preserve the existing React 18, TypeScript, Rspack, Zustand and chat component architecture unless a written architecture decision proves otherwise.
- Build a modular monolith first. Model/provider expansion is an architectural foundation, not permission to prematurely build teams, customer APIs, credit packs or multiple inference providers.
- Keep local-only capabilities (BYOK, workspace, NanoVM, browser tools, MCP experiments and Android behavior) distinct from authenticated commercial services. Do not grant a backend service access to them implicitly.
- Never silently upload, migrate, overwrite or delete a user's existing local conversations/settings. Account migration requires explicit user consent and ownership-safe import semantics.
- Before implementing a cross-cutting change, read `docs/commercial/ARCHITECTURE_AUDIT.md`, `PRODUCT_REQUIREMENTS.md`, `TECHNICAL_ARCHITECTURE.md`, `IMPLEMENTATION_ROADMAP.md`, `SECURITY_REVIEW.md`, `CREDIT_SYSTEM.md`, and `RUNPOD_INFERENCE.md`; update documentation when behavior/decisions change.

## Development conventions

- Work on a dedicated feature branch; never modify `main` directly. Preserve pre-existing worktree changes and inspect before editing.
- Use the existing pnpm lockfile and scripts. Strict TypeScript is required (`tsconfig.json`); preserve repository formatting/lint settings. Do not weaken lint/type/test checks to force a pass.
- Make small, reviewable changes. Keep provider-specific protocol code inside adapters; business logic and frontend code use normalized contracts.
- Add tests for new critical behavior and run the entire relevant test module/file, plus all available root checks (`pnpm type`, `pnpm lint`, `pnpm build`). Record failures accurately; do not claim tests not executed.
- Grep all call sites and duplicated patterns after changing a signature, protocol or check. Review the full diff for unnecessary behavior changes and confirm scope.
- Never commit credentials, production data, operator files, `.env` secrets, provider tokens, session keys, signing keys or Vercel deployment credentials. Use hosting secret management. Vercel may be used for an explicitly scoped non-production sandbox; no production deployment/data/payment/provider charge without operator approval.
- Do not remove or materially change existing functionality without documenting the reason and compatibility impact. Preserve license notices and upstream attribution; get legal review for AGPL/GPL assets and commercial distribution.

## Security rules

- The browser is untrusted. Never trust browser-supplied user IDs, roles, plan/subscription state, credit balance, provider/model identifiers, token usage, billing events or entitlement decisions.
- Provider and payment credentials are server-only. Never expose Runpod/Stripe secrets, provider endpoint credentials or privileged server tokens to client code, source maps, logs or errors.
- Enforce authentication and resource ownership server-side on every protected route. Admin authorization is independent of UI visibility and user-editable profile data.
- Validate and bound every request at the server boundary. Enforce model allowlists, input/context/output limits, rate and concurrency limits, CSRF/session defenses and safe error normalization.
- Verify payment webhook signatures over the exact raw request body before effects; persist unique provider event IDs and process idempotently.
- Avoid logging prompt/message content, attachment bytes, keys, session tokens, passwords, payment secrets or recovery tokens. Use request/correlation IDs and redacted operational metadata.
- Treat fetched pages, user files, model output and tool output as untrusted. Do not enable server-side browser/MCP/NanoVM tools without separate data-boundary and prompt-injection review.
- Do not proxy arbitrary client-supplied provider URLs. Protect Android local proxy and MCP server from public exposure without authentication, allowlists and abuse controls.

## Credit accounting invariants (non-negotiable)

1. Customer credits and model rates use integer units only; no floating-point balance arithmetic.
2. The server/database is the sole authority for balance, entitlements, model pricing, usage and subscription grants.
3. The ledger is immutable and append-only. Corrections/refunds/admin adjustments are compensating transactions; never rewrite history or overwrite a historical balance.
4. Reservation/check/update and settlement/release happen atomically in database transactions; negative spendable balance is impossible, including concurrent requests.
5. Every grant, reservation, settlement, release, refund, webhook effect and adjustment has a durable idempotency key and related request/subscription references.
6. Monthly credits are granted only from verified authoritative subscription/payment events, exactly once per entitlement period—not from client redirects.
7. Reserve the conservative maximum before inference. Settle measured, normalized server/provider usage against a pricing snapshot; release unused reservation once.
8. Provider monetary cost is kept separate from customer credit charges. Pricing/config changes cannot reinterpret historical usage.
9. Browser disconnect does not itself cancel a provider job or authorize a refund. Record terminal provider state and reconcile crashes/stuck reservations.
10. If actual provider usage is absent, use an explicit documented model-compatible server estimate or conservative reservation fallback; never trust browser token counts or silently assume zero.
11. Refunds and adjustments require guarded state transitions and an audit trail; duplicate settlement/release/refund must be a no-op or explicit conflict, never a second credit movement.

## Required gates before commercial release

- Database migrations, type checks, lint, production build, relevant unit/integration/E2E suites pass.
- User isolation, admin denial, duplicate/replayed webhook, concurrent credit spend, provider failure, disconnect and reconciliation cases are tested.
- Security and license review findings have owners/dispositions; production secrets remain outside development checkout.
- Live Stripe/Runpod/Google/email claims are made only after configured sandbox/live evidence; credentials and paid tests require operator-approved setup.
