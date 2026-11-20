# Credit System

## Invariants

1. Credit values and model rates are integers in a defined smallest credit unit; never use floating point.
2. The server/database are authoritative. Browser values, displayed balances, token counts, plan names and payment redirects are not authoritative.
3. `credit_transactions` are immutable append-only records. Corrections are compensating transactions, never rewrites.
4. A user cannot have a negative available balance. Reserve/check/update occur atomically.
5. Every grant, reservation, settlement, release, refund and adjustment carries an idempotency key and related entity references.
6. Customer price credits and provider cost data are separate; provider cost cannot silently change customer charges.
7. A disconnected browser does not imply an unstarted generation or entitlement to a refund.

## Entities

- `credit_accounts`: one account per user; cached/derived balance fields only when maintained transactionally.
- `credit_allocations`: source entitlement grants with grant/expiry periods and subscription linkage.
- `credit_reservations`: state (`active`, `settled`, `released`, `expired`), maximum reserved units, inference request, expiry and version.
- `credit_transactions`: immutable ledger rows with transaction type, signed amount, before/after balances, idempotency key, metadata, user, reservation, subscription and inference references.
- `usage_records`: authoritative normalized input/output/reasoning/cached token counts, pricing version, calculated customer charge and provider metadata.
- `inference_requests`: idempotency key, lifecycle, model/pricing snapshot, provider job/correlation IDs, completion/error timestamps.

## Reservation and settlement

1. Authenticate and validate the request.
2. Resolve server-owned model/pricing and calculate a conservative maximum charge from validated input/max output caps.
3. In one transaction lock/update the credit account, reject insufficient available credits, create an active reservation, append a reservation ledger transaction and create/idempotently return `inference_requests`.
4. Submit to provider after the reservation is durable.
5. Stream normalized events while collecting provider usage. Client abort only records consumer detachment unless the service explicitly cancels a provider job.
6. On a terminal provider outcome, normalize actual usage and calculate actual integer charge using the captured pricing version.
7. In one transaction lock the reservation, reject a non-active transition, append settlement/debit and unused-release transactions as applicable, mark reservation terminal and persist usage/request outcome.
8. If provider submission never succeeds, release once. If partial output was produced, apply the published partial-generation rule based on actual/fallback measured usage, not a blanket refund.

## Pricing model

A model pricing record supports integer rates for input, output, reasoning and cached tokens, a context window/max output limit, effective dates and provider-cost metadata. The model registry/pricing snapshot is copied onto each inference request so later pricing changes cannot reinterpret historical usage.

Fallback metering when provider usage is absent must be explicit: use a server tokenizer/version where model-compatible, or charge the pre-reserved maximum under a documented conservative policy. Never accept client token counts or silently set usage to zero.

## Subscription grants

A verified Stripe event activates subscription state. Monthly/annual entitlement grant processing must use a deterministic period/subscription idempotency key. `invoice.paid`/provider-equivalent authoritative payment success is the grant trigger; a Checkout success redirect is not. Cancellation changes future renewal behavior but does not erase immutable earned credits; expiration behavior is driven by allocation expiry rules.

## Failure/reconciliation matrix

| Scenario | Required outcome |
| --- | --- |
| Duplicate inference submission | Return/link the original request using user-scoped idempotency key; never reserve twice. |
| Concurrent requests | Transaction/row lock ensures aggregate active reservations cannot exceed available credit. |
| Provider request rejected before start | Release active reservation once; record failed request. |
| Worker/process crash after submit | Reconciler queries provider by saved job ID/correlation and settles/release according to terminal state. |
| Browser disconnect | Continue server tracking; only cancel if explicit cancellation policy/provider state supports it. |
| Duplicate webhook | Unique provider event record prevents duplicate lifecycle/grant effects. |
| Manual adjustment | Append audited adjustment transaction; never edit historical balance rows. |
| Stale reservation | Reconciliation locks it, checks provider state, then settles/releases using idempotent terminal operation. |

## Test requirements

Unit tests cover rounding, rate snapshots, estimates, settlement/release/refund state transitions and idempotency. Integration tests use transactional concurrent reservations to prove non-negative balances, duplicate webhook/grant delivery, provider failure before/after output, and reconciliation recovery. No test may modify a production ledger or provider account without explicit approval.
