# Runpod Inference Design

## Phase 1 decision

Use one server-owned Runpod Serverless endpoint for one configured DeepSeek model. The browser contacts only the application gateway; it never receives a Runpod endpoint ID, API key, job ID with reusable credentials, or provider secret.

## Verified Runpod API facts

Official Runpod documentation reviewed during Phase 0:

- Queue-based endpoints provide `POST /runsync`, `POST /run`, `GET /status/{job_id}`, `GET /stream/{job_id}`, `POST /cancel/{job_id}`, retry and health operations.
- `/run` is asynchronous; results are retained for 30 minutes. `/runsync` is synchronous and results are retained for one minute.
- Queue endpoint streaming requires a streaming-capable worker handler. Runpod recommends load-balancing endpoints for real-time/custom HTTP interfaces. We will validate the selected worker/engine before choosing the final endpoint shape.
- Requests authenticate with server-side bearer credentials at `https://api.runpod.ai/v2/{ENDPOINT_ID}`.
- Endpoint settings include active/max workers, idle timeout, execution timeout, job TTL, FlashBoot and GPU priority. Cold starts, queue time and TTL are operationally material.
- Retrying a submission after timeout/5xx can create a duplicate billed job; application idempotency and persisted provider job mapping are mandatory.

Sources: [Send API requests](https://docs.runpod.io/serverless/endpoints/send-requests), [Endpoint settings](https://docs.runpod.io/serverless/endpoints/endpoint-configurations), reviewed in Phase 0.

## Adapter contract

```ts
interface InferenceProvider {
  stream(request: NormalizedInferenceRequest, context: ProviderRequestContext): AsyncIterable<NormalizedStreamEvent>
  generate(request: NormalizedInferenceRequest, context: ProviderRequestContext): Promise<NormalizedGenerationResult>
  getStatus(providerJobId: string): Promise<ProviderJobStatus>
  cancel(providerJobId: string): Promise<ProviderCancellationResult>
  healthCheck(): Promise<ProviderHealth>
  normalizeUsage(raw: unknown): NormalizedUsage | null
}
```

`RunpodInferenceProvider` owns HTTP endpoints, headers, retries and job state. `DeepSeekModelAdapter` owns prompt/model payload shaping and maps model-engine events to the existing frontend-compatible stream contract. No billing, credit or UI code inspects Runpod response shapes.

## Gateway streaming model

The application gateway authenticates, authorizes, reserves credits and creates the durable request before provider submission. It then bridges provider output to application SSE. Server-side work continues enough to observe terminal provider state and settle credits even if the client disconnects.

Before implementation, validate with a controlled endpoint that the chosen DeepSeek worker supports the desired incremental output semantics, terminal usage payload, cancellation behavior, request timeout behavior and correlation ID propagation. If queue `/stream` output does not satisfy chat latency/format requirements, deploy a thin worker adapter or use a load-balancing endpoint behind the same `InferenceProvider` contract. This is an implementation choice, not a frontend API change.

## Model registry

Every enabled model has an internal ID, display name, provider, provider model identifier, endpoint reference, active state, capability flags, context/max-output limits, plan eligibility, integer customer credit rates and separate provider cost metadata. The client sends only the internal ID. The server rejects inactive/unentitled models and arbitrary endpoint/model parameters.

## Reliability controls

- Bound gateway request size, context, max output, active generations and per-user/IP rate limits.
- Persist provider job ID and correlation ID before relying on streaming completion.
- Use conservative, bounded retry rules; never resubmit ambiguously accepted jobs without checking persisted/provider status.
- Handle cold-start/queue latency as a user-visible normalized status, never expose raw provider secrets/errors.
- Reconcile requests whose server process, stream bridge or browser connection dies.
- Health checks use redacted diagnostics and never expose credentials.

## Configuration requirements

Runtime configuration requires server-only Runpod API credential, endpoint reference, model-adapter configuration, safe timeout/TTL limits and optional provider webhook verification configuration. Values are supplied through the hosting secret manager; no credential is committed, passed to the browser, placed in local `.env` shared with agents, or written into docs.
