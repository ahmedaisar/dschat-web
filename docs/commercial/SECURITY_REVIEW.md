# Security Review — Initial Static Audit

Status: **Phase 0 assessment only; not a penetration test or release approval.** Findings refer to the current code, before commercial changes.

## Findings

| Severity | Finding and evidence | Required control |
| --- | --- | --- |
| Critical | No commercial authentication/authorization/data isolation exists. `src/services/chat/store.ts` and `src/services/chat/db.ts` use client-generated IDs and browser-owned stores. | Add server sessions, deny-by-default route guards, ownership constraints and cross-user integration tests. |
| Critical | Provider keys are plaintext in localStorage (`src/services/settings.ts#setApiKey`, custom provider persistence); direct calls attach credentials in `src/services/api/client.ts` and `src/services/api/openaiCompatible.ts`. | Commercial managed requests only through server-side secrets and gateway; preserve local BYOK only as isolated opt-in. Rotate any credentials exposed by XSS/compromised origin. |
| High | Arbitrary custom provider base URLs and model IDs are client-configurable (`normalizeCustomProviderBaseURL`, `src/services/api/provider.ts`). | Never server-fetch arbitrary browser destinations. Future BYOK requires SSRF defenses, strict allowlists, encrypted secrets, explicit consent and egress policy. |
| High | Limits/usage/entitlements and model controls are client-side (`src/services/chat/store.ts`, `src/services/chat/dailyUsage.ts`, `src/services/chat/usageLedger.ts`). | Enforce all limits, model entitlements and costs server-side from trusted configuration/provider usage. |
| High | Browser tools can fetch external URLs and consume model/tool output; see `src/services/agent/tools.ts`, `src/services/agent/runTool.ts`, approvals in `src/services/agent/approval.ts`. | Keep tools local-only initially. If server-side tools are later enabled, treat retrieved content as untrusted, isolate tool credentials/data, enforce network allowlists and require approval for side effects. |
| High | Jailbreak and safety-omission capabilities (`src/services/unrestricted/*`, settings in `src/components/settings/SettingsDialog.tsx`) conflict with commercial provider, misuse and policy requirements. | Local-only in Phase 1; product/legal/provider policy decision and abuse model required before paid gateway support. |
| High | Python MCP server accepts expensive caller-controlled model workloads and has no authentication (`mcp-server/easyjailbreak_mcp/server.py`, `runner.py`); broad CORS is not access control. | Preserve loopback default. Do not expose publicly; require auth, bounded concurrency/cost budgets, request validation and audited access before non-loopback operation. |
| High | Android WebView allows cleartext and mixed content (`android/AndroidManifest.xml`, `MainActivity.java`); `LocalServer.java#serveProxy` accepts arbitrary target URLs/follows redirects; token uses `Random`. | Keep Android usable, but tighten proxy destination/scheme/redirect rules, generate token with `SecureRandom`, and review WebView policy before commercial auth use. |
| Medium | Same-origin XSS exposes local provider secrets and all IndexedDB content. Markdown itself uses AST rendering, but generated HTML sinks exist in `src/components/markdown/CodeBlock.tsx`, `MathFormula.tsx`, and `MermaidDiagram.tsx`. | Maintain sanitizer/dependency review and tests at HTML sinks; CSP/Trusted Types where feasible; avoid third-party script injection; keep credentials out of client storage. |
| Medium | Conversation data includes messages, thinking/reasoning blocks, attachments, citations and provider IDs in IndexedDB (`src/services/chat/db.ts`, `src/services/chat/types.ts`). | Explicit migration consent, retention/deletion policy, tenant-owned blob authorization, data minimization and encrypted transport/storage policies. |
| High | License obligations exceed root MIT claim: AGPL notice `src/services/unrestricted/COPYING-AGPL-3.0`; bundled EasyJailbreak license at `android/assets/backend/EasyJailbreak/LICENSE`; see also `docs/en/11-license.md`. | Legal review, full dependency/SBOM inventory and compliant distribution/service architecture before launch. |
| Medium | GitHub star-history workflow has write permission and floating action refs (`.github/workflows/star-history.yml`, verify current ref values during release review). | Pin third-party actions to immutable SHAs; minimize permissions and isolate write automation. |

## Target controls checklist

### Identity and sessions
- Adopt a maintained auth framework; secure HTTP-only, Secure, appropriately SameSite cookies; CSRF protection for state-changing cookie-auth requests.
- Verify email/reset tokens, expire and consume them once; rate-limit registration/login/recovery.
- Derive identity exclusively from session; enforce ownership in repository queries, not frontend routes.
- Separate role assignment from user-editable profile; test admin boundaries on every admin route.

### Inference and credits
- Runtime schemas for every request; bounded body, message/context/output sizes and attachment types.
- Trusted registry IDs only; no provider URL or arbitrary upstream model supplied by client.
- Atomic, integer, idempotent credit reservation/settlement; concurrency tests and stale-job reconciliation.
- Per-user/IP/plan rate and concurrent-generation limits; safe generic provider errors.
- Do not trust browser usage/tokens/balance or redirect state; verified webhooks only.

### Billing/webhooks
- Verify Stripe signatures against unmodified raw body and configured signing secret before side effects.
- Persist unique provider event IDs and process lifecycle effects transactionally/idempotently.
- Validate relevant subscription/invoice references before granting monthly credits; do not grant on checkout redirect.
- Protect checkout/portal actions with session + ownership checks; never expose secret keys.

### Data and logs
- Tenant-scoped foreign keys and query predicates; test cross-user conversations/files/usage denial.
- No secrets, session tokens, raw payment methods, full user content or attachment bodies in normal logs.
- Use request/correlation IDs and redacted provider metadata; define user deletion, backups and retention.
- Migration from IndexedDB/localStorage is explicit, user initiated and reversible before commit.

### Supply chain and deployment
- Produce an SBOM and license report including JavaScript transitive packages, Python and bundled Android assets.
- Pin GitHub Actions/dependencies where feasible; scan dependencies and generated artifacts.
- Keep production credentials in host secret management; no `.env` credentials in development checkout or client variables.
- Use Vercel sandbox only for non-production checks; production deployment and real-data/provider/payment tests require explicit operator approval and separate production credentials.

## Verification still required before production

Static audit does not verify a live authentication provider, email delivery, Stripe configuration, Runpod worker protocol, Android threat surface, database permissions, CSP, or production hosting behavior. These require implementation tests, independent review, configured sandbox accounts and operator-approved deployment. No production readiness claim is made here.
