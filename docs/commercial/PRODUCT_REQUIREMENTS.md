# Commercial Product Requirements

## Product objective

Evolve this personal, browser-BYOK chat application into a commercially operable AI chat SaaS. Phase 1 serves one configured DeepSeek model through server-owned Runpod infrastructure. The browser never supplies an inference-provider API key for commercial requests.

## Phase 1 scope

### Public experience
- Landing and pricing pages.
- Terms and privacy pages approved by the business owner before launch.
- Registration, email/password sign-in, email verification, password reset, logout, optional Google OAuth when configured.

### Authenticated customer experience
- Existing chat experience with server-SSE streaming.
- Server-authoritative credit balance and per-generation usage summary.
- Account/profile and account deletion workflow.
- Subscription status, Stripe Checkout, billing portal, billing/usage history.
- Model availability and clear entitlement/error messages.
- Previous conversations scoped to the authenticated user.

### Operator experience
- Admin-only management of users, plans/prices, model registry/pricing, subscriptions, inference/usage records and account state.
- Audited additive credit adjustments; no historical mutation.
- Health/reconciliation operational views.

## Explicit Phase 1 exclusions

- More than one live commercial model/provider.
- One-time credit packs, teams/organizations, customer API keys/API access, advanced model selection, provider routing, or server-side browser/NanoVM/MCP tools.
- Proxying arbitrary user-configured provider URLs or credentials.
- Enabling unrestricted/jailbreak laboratory capability in server-backed paid inference without a dedicated product-policy and abuse review.

## Functional requirements

| Capability | Acceptance criterion |
| --- | --- |
| Identity | A user can register, verify email, sign in/out, reset password, edit profile, and request deletion. Protected API calls derive user identity only from the server session. |
| Roles | `user` and `admin` are enforced server-side; hiding UI does not confer or revoke authority. |
| Plans | Plans/prices/credit allocations are configuration/data driven, not hardcoded in UI or services. Free, monthly, and annual plan capabilities are representable. |
| Billing | Stripe Checkout and Billing Portal are available when configured. Verified webhooks—not redirects—synchronize lifecycle and grant credits exactly once. |
| Credits | User balance is derived from an immutable integer ledger. A paid inference atomically reserves, settles or releases credits. |
| Inference | A trusted model ID resolves server-side to configured model/provider data. The gateway validates limits/entitlement, rate limits, streams, records usage and settles credits. |
| Conversations | Users can access only owned conversations/messages/files. Existing local histories remain local until user-directed import/migration. |
| UI | Existing streaming, markdown, branches, responsive behavior and i18n remain viable. Insufficient credits, expired subscription, unavailable model and failures are understandable without provider internals. |
| Admin | Every administrative state change produces an immutable audit event and is authorization-checked. |
| Operations | Health checks, correlation IDs, structured/redacted logs and reconciliation for stale reservations/unsettled jobs exist before commercial release. |

## Non-functional requirements

- Strict TypeScript; input schemas at every HTTP boundary.
- No provider secret, Stripe secret, session secret, raw webhook payload containing sensitive data, or full chat content in routine logs.
- Configurable input/output/concurrency/rate limits.
- Database transactions must protect credit state under concurrent requests.
- Durable idempotency for browser inference submission, billing webhooks, entitlement grants and ledger settlement/refund operations.
- Accessibility/responsiveness should retain the established desktop/mobile component behavior.

## Existing-feature policy

| Existing area | Phase 1 policy |
| --- | --- |
| Local chat/history/export/import | Preserve. Do not silently upload legacy data. |
| BYOK/custom providers | Keep only as clearly labeled local mode until a separate secure BYOK design exists; no commercial gateway proxy. |
| Browser tools/workspace/NanoVM | Preserve local operation; no server credentials, account data, or privileged tools exposed to model output. |
| MCP EasyJailbreak/lab and unrestricted modes | Preserve repository code; do not include in paid managed endpoint unless explicitly authorized after security/product review. |
| Android | Preserve static/local compatibility. Account login and commercial gateway support require separate Android acceptance tests. |

## Definition of Phase 1 done

The commercial MVP definition in the mission is satisfied only after implementation, migration, unit/integration/E2E evidence, production-build checks, external-provider configuration verification, and operational documentation are complete. Credential-dependent functionality is reported as configured-but-unverified until executed against an approved sandbox/test account.
