# Commercial Architecture Audit

## Executive assessment

The repository is a static, browser-first React chat application, not a multi-tenant SaaS. It has strong reusable chat UI, normalized streaming parsing, local conversation persistence, responsive layout, i18n, workspace/NanoVM, and browser-tool capabilities. It has **no tracked commercial server, database, authentication, authorization, billing, server-side inference gateway, or automated frontend test suite**.

The MVP must be built as a modular monolith with a server-owned PostgreSQL data model and provider credentials. Replacing the frontend wholesale is not justified.

## Verified current architecture

| Area | Evidence | Finding | Commercial disposition |
| --- | --- | --- | --- |
| Build | `package.json`, `rspack.config.ts#createConfig`, `tsconfig.json` | React 18, TypeScript strict mode, Rspack static build. `__API_ORIGIN__` defaults to `https://api.deepseek.com`. | Preserve frontend/build; add a server deployment boundary. |
| Bootstrap | `src/main.tsx`, `src/app/App.tsx` | Initializes theme, KaTeX, OPFS/workspace, NanoVM, and local chat persistence. | Preserve and sequence server hydration after local initialization. |
| Chat state | `src/services/chat/store.ts#useChatStore` | Zustand command surface supports send/stop/regenerate/continue/edit/branch/fork/remove/import. | Preserve UI command surface; replace transport/persistence implementations behind it. |
| Streaming | `src/services/api/sse.ts#ServerSentEventDecoder`, `src/services/api/client.ts#streamMessage`, `src/services/api/openaiCompatible.ts#BlockTracker` | POST-compatible WHATWG streaming and normalized internal events already exist. | Reuse the normalized event contract for server SSE. |
| Providers | `src/services/api/client.ts`, `src/services/api/openaiCompatible.ts`, `src/services/api/provider.ts` | Browser directly contacts DeepSeek or arbitrary OpenAI-compatible endpoints. | Commercial traffic must use an authenticated gateway; BYOK becomes explicitly isolated/deferred. |
| Models | `src/services/api/models.ts#BUILTIN_MODELS` | Built-in model strings plus client-fetched remote models/cached list. | Replace commercial selection with trusted server registry IDs. |
| Persistence | `src/services/chat/db.ts`, `src/services/chat/types.ts`, `src/services/settings.ts` | IndexedDB database `chat-demo` v11 holds sessions/files; localStorage holds settings and provider keys. | Retain local import/export compatibility; add account-owned server conversations. |
| UI | `src/components/{base,chatInput,messages,session,sider,markdown,settings}/` | Mature responsive components, markdown, syntax, math, branches, thinking, attachments, i18n. | Preserve; integrate account/billing states incrementally. |
| Extra capabilities | `src/services/{agent,nanovm,workspace,unrestricted}/`, `src/components/{lab,nanovm}/` | Browser tools, workspace/OPFS, NanoVM, MCP jailbreak laboratory, unrestricted prompt features. | Keep local-only features; do not make them server-enabled until a separate authorization/threat-model review. |
| Deployment | `vercel.json`, `.github/workflows/pages.yml` | Static Vercel output and GitHub Pages deployment. | Incompatible with secure paid inference alone; replace/augment with server-capable deployment. |

## Existing functionality inventory

**Preserve now:** chat rendering, SSE incremental rendering, markdown/Prism/KaTeX/Mermaid, message editing and branches, context and compression UI, thinking controls, modes, responsive desktop/mobile layout, English/Chinese i18n, local export/import, workspace, NanoVM, browser tools and Android wrapper.

**Reuse directly:** `useChatStore` commands, `MessageStreamEvent`-style normalized stream handling, `BlockTracker`, `ServerSentEventDecoder`, `applyEvent`, `toRequestMessages`, base UI primitives, message/session components, and the IndexedDB archive format code.

**Refactor behind stable UI boundaries:** `streamMessage()` and direct provider calls; model selection; usage ledger; conversation persistence; settings that currently store provider credentials; error translation.

## Material security and commercial-readiness findings

1. **Critical — browser-owned provider credentials.** `src/services/settings.ts#setApiKey` and custom provider state persist plaintext keys in localStorage. `src/services/api/client.ts` and `openaiCompatible.ts` transmit them directly. SaaS inference credentials must never enter the browser.
2. **Critical — no server authorization or tenant boundary.** Session IDs and usage state are client-created; no authenticated ownership check exists.
3. **High — all limits are advisory.** Daily usage, model availability, input shaping, attachment limits, safety settings, and request token assumptions in `src/services/chat/store.ts` are browser-controlled.
4. **High — arbitrary custom-provider egress.** `normalizeCustomProviderBaseURL()` accepts arbitrary `http:`/`https:` destinations. A commercial server must not proxy arbitrary URLs or user credentials.
5. **High — commercial policy conflict.** `src/services/unrestricted/*`, settings controls that omit `safety_check`, and EasyJailbreak/MCP laboratory features require a separate product-policy decision before server-side availability.
6. **Medium — sensitive local data.** IndexedDB contains message content, thinking blocks, attachments and provider file IDs; localStorage contains memories, usage, settings and keys. Migration must be opt-in and account-scoped.
7. **Medium — renderer dependency trust.** `CodeBlock.tsx`, `MathFormula.tsx`, and `MermaidDiagram.tsx` use generated HTML. Maintain regression tests and dependency review around this boundary.
8. **Medium — deployment mismatch.** GitHub Pages and static Vercel output cannot keep secrets or enforce paid access.
9. **High — licensing/product review required.** Root `LICENSE` is MIT, but `src/services/unrestricted/COPYING-AGPL-3.0`, bundled `android/assets/backend/EasyJailbreak/LICENSE` (GPL-3.0), the unrestricted engines identified in `docs/en/11-license.md`, and brand-art rights require counsel review before commercial distribution. `pnpm licenses list --prod` reported mostly MIT, plus `khroma` as Unknown and `robust-predicates` as Unlicense; create a complete SBOM/license gate before release.
10. **High — Python MCP service boundary.** `mcp-server/easyjailbreak_mcp/server.py` supports a host option but no authentication; its broad CORS allowlist is not authorization. Keep it loopback-only and out of the paid inference path unless hardening and separate abuse/cost limits are completed.
11. **High — Android network bridge.** `android/AndroidManifest.xml` enables cleartext traffic and the WebView allows mixed content. `android/src/com/xiaohuangbo/deepseekunrestricted/LocalServer.java#serveProxy` accepts caller-controlled targets and redirects; its token is generated with `Random`, not `SecureRandom`. Preserve Android functionality but harden this bridge before commercial account credentials can be used in the WebView.

## Technical debt and migration constraints

- The existing data model supports branching DAG-like conversations, streamed assistant blocks, attachments, compression, citations and tool calls. Server migration must preserve these structures or document explicit loss rules.
- Provider-side uploaded-file IDs currently survive in local history; deletion/import must account for provider/object-store data separately.
- Browser disconnect presently aborts client consumption. Gateway accounting must treat disconnect as transport state, not automatic cancellation/refund.
- No project test script exists (`package.json` has `dev`, `build`, `type`, `lint`, `format` only). Tests must be introduced rather than retrofitting verification claims.

## Audit evidence and baseline scope

Read source/configuration includes `README.md`, `README.zh-CN.md`, `package.json`, `rspack.config.ts`, `tsconfig.json`, `vercel.json`, GitHub workflow configuration, root license, the tracked `docs/en` and `docs/zh` trees, frontend entry points/services/components, Android assets, and MCP server sources. Current source-of-truth is code where documentation diverges.

See `SECURITY_REVIEW.md`, `TECHNICAL_ARCHITECTURE.md`, `CREDIT_SYSTEM.md`, and `IMPLEMENTATION_ROADMAP.md` for the approved remediation design.
