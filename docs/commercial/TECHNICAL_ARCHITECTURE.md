# Technical Architecture

## Decision

Build a **TypeScript modular monolith** alongside the existing React/Rspack client. Retain the client as the presentation layer and introduce one server application owning authentication, PostgreSQL persistence, billing, credits, model authorization, inference gateway, admin APIs, reconciliation and observability. Do not introduce microservices in Phase 1.

The current static-only deployment (`vercel.json`, `.github/workflows/pages.yml`) is insufficient for secrets, webhooks, sessions and transactions. Vercel may host server routes only where its runtime/streaming/database connectivity satisfies the documented gateway requirements; otherwise deploy the monolith to a compatible Node runtime. The connected Vercel project is a sandbox, never a substitute for production credentials or data.

## Bounded modules

| Module | Owns | Must not own |
| --- | --- | --- |
| Web client | UI, local drafts/local-only features, rendering normalized SSE, account pages | provider secrets, balances, role truth, provider endpoint selection |
| Auth | sessions, passwords/OAuth, verification/recovery, user identity/roles | billing entitlement decisions |
| Data | PostgreSQL schema, migrations, repositories and tenant ownership predicates | HTTP/provider protocol formatting |
| Billing | plan catalog mapping, Stripe Checkout/Portal, verified webhooks, subscription projection | direct credit balance mutation outside ledger service |
| Credits | accounts, allocations, reservations, append-only transactions, settlement/reconciliation | Stripe signature handling, provider wire formats |
| Models | trusted registry, pricing/limits/capabilities and entitlement resolution | browser-selected endpoint URLs |
| Inference | validated gateway, provider adapters, normalized streaming, idempotency, request/usage records | UI state and client token estimates |
| Admin | admin-only commands and audit trail | mutable historical credit records |
| Operations | health, structured logs, request/correlation IDs, scheduled reconciliation | sensitive content/secret logging |

## Server contracts

All protected routes obtain identity from secure session cookies; body/query user IDs are ignored for authorization.

- `POST /api/auth/*`: framework-owned registration/session/recovery/OAuth routes.
- `GET/PATCH /api/me`: profile and account summary.
- `GET /api/plans`, `POST /api/billing/checkout`, `POST /api/billing/portal`.
- `POST /api/webhooks/stripe`: raw-body signature verification then idempotent event processing.
- `GET /api/credits`, `GET /api/usage`, `GET/POST /api/conversations`, tenant-scoped conversation/message endpoints.
- `POST /api/inference/stream`: authenticated, idempotent SSE gateway. Request contains only a trusted model ID and validated conversation input.
- `GET /api/health`, restricted readiness/provider health checks.
- `/api/admin/*`: explicit server-side role enforcement plus `admin_audit_logs` writes.

Exact framework routing paths may follow the backend framework selected during Phase 1, but these boundary contracts are mandatory.

## PostgreSQL design

Core tables: `users`, auth framework `sessions`, `accounts`, `verification_tokens`; `plans`, `plan_prices`, `payment_customers`, `subscriptions`, `payment_events`, `invoices`, `webhook_events`; `credit_accounts`, `credit_allocations`, `credit_reservations`, `credit_transactions`; `models`, `model_pricing`, `inference_requests`, `usage_records`; `conversations`, `messages`, `message_attachments`; `admin_audit_logs`.

Required constraints:
- unique user-to-credit-account, provider-customer identity and provider webhook event ID;
- every user-owned row has a foreign key to user/owner and tenant-scoped access query;
- `credit_transactions` are append-only with unique idempotency key per operation scope;
- reservations cannot be settled/released more than once; enforce state transition/version checks;
- integer credit amounts, non-negative reservation/available balance invariants under a transaction;
- model IDs are internal UUIDs/opaque IDs; provider endpoint/model identifiers never originate from a browser request;
- indexed ownership/time/status columns for user history, reconciliation and admin queries.

## Inference flow

1. Session middleware authenticates user and attaches a request ID.
2. Schema validation enforces message, attachment reference, context and requested-output limits.
3. Server resolves the model registry entry and user plan entitlement.
4. The credit service calculates maximum integer reservation from authoritative rates and caps.
5. One database transaction creates `inference_requests` and an active reservation, rejecting insufficient balance/concurrency/idempotency conflicts.
6. The Runpod adapter submits the job using server-only credentials and returns normalized events through application SSE.
7. Browser disconnect is recorded but does not automatically cancel provider work.
8. Provider-reported usage is normalized; a final transaction records usage, appends settlement/release transactions and completes the request.
9. Failures use documented partial-generation rules; only a single guarded release/refund path can affect a reservation.
10. Reconciliation resolves terminal provider jobs and stale local reservations.

## Frontend adaptation

Preserve `src/services/chat/store.ts#streamReply`, `src/services/chat/reply.ts#applyEvent`, and the message components. Replace direct calls in `src/services/api/client.ts#streamMessage` and `src/services/api/openaiCompatible.ts#streamOpenAICompatibleMessage` for managed mode with a first-party authenticated transport. Keep the existing normalized stream event protocol where possible so markdown, thinking, tools and branch UI do not require a rewrite.

`src/services/chat/db.ts` remains the legacy/local archive adapter. Server persistence becomes the source of truth only after a signed-in user opts to create/import account data; migration must not scrape or silently upload IndexedDB/localStorage content.

## Provider abstraction

`InferenceProvider` must isolate `generate`, `stream`, `getStatus`, `cancel`, `healthCheck`, and `normalizeUsage`. `RunpodInferenceProvider` maps Runpod only inside the infrastructure module. `DeepSeekModelAdapter` owns model request/response semantics. Application services consume normalized types only.

## Security architecture

- Secure HTTP-only, `Secure`, same-site session cookies; CSRF defense appropriate to framework/cookie mode.
- Password hashing/auth framework handles password and recovery token security; never roll bespoke password crypto.
- Runtime configuration validates required server-only environment variables at startup; client-exposed variables are separately named and reviewed.
- Redis is optional in Phase 1: introduce it only when multi-instance rate limiting/distributed generation locks require it. PostgreSQL transactions are the ledger source of truth.
- Rate limits span identity, IP risk signal, plan and active generation count; they are not client settings.
- Redact secrets and prompt content by default in structured logs.
