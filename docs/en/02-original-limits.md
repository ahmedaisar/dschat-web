## 2. Restrictions in the original

These are the limit-related behaviours in the upstream code. Paths point at the upstream implementation; in this fork those files have been modified (see section 3).

### 2.1 Request side

| #   | Restriction                              | Where in the original                              | Behaviour                                                                                                                             |
| --- | ---------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Hard-coded system prompt                 | `SYSTEM_PROMPT` in `src/services/chat/store.ts`    | Every request's `system` field is one identity sentence: `该助手为DeepSeek，由深度求索公司创造。`. No behavioural instructions at all |
| 2   | Base safety filtering always on          | `SAFETY_CHECK` in `src/services/chat/store.ts`     | Every request carries `safety_check: { level: 'high' }`; the comment states it is "always on"                                         |
| 3   | Model and sampling parameters hard-coded | `src/services/chat/store.ts`                       | Model pinned to `deepseek-flash`; `temperature`, `top_p`, and `max_tokens` are never sent and the server defaults apply               |
| 4   | Fixed tool declarations                  | `serverTools` in `src/services/chat/store.ts`      | `deepseek_read_url` is always declared; `deepseek_web_search` follows the smart-search toggle                                         |
| 5   | Streamed content discarded on refusal    | `settleReply` in `src/services/chat/reply.ts`      | When a stream ends with `stop_reason: 'refusal'`, all received `thinking` / `text` blocks are **deleted**; only tool blocks survive   |
| 6   | Refused turns excluded from context      | `isUsableReply` in `src/services/chat/reply.ts`    | Rounds with `stopReason === 'refusal'` are never sent back to the model                                                               |
| 7   | Refused replies cannot be continued      | `canContinueReply` in `src/services/chat/reply.ts` | Returns `false` for refusal, so the "Continue" button never appears                                                                   |
| 8   | Refused replies show a canned answer     | `src/services/chat/describe.ts`                    | Refusals render a fixed sentence: `你好，这个问题我暂时无法回答，让我们换个话题再聊聊吧。`                                            |
| 9   | Refused replies cannot be edited         | The original has no reply editing                  | Only the user prompt can be edited (which creates a new branch and regenerates)                                                       |

### 2.2 UI and technical boundaries (not safety policy, listed for completeness)

| #   | Item              | Where                                          | Notes                                                                                                              |
| --- | ----------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 10  | AI content notice | Under the composer                             | A fixed line, "AI-generated, for reference only". Display only, it blocks nothing (kept unchanged in this fork)    |
| 11  | Attachment limits | `src/services/attachments.ts`, `uploadExts.ts` | 64 MB per file, 50 files per conversation, extension allow-list (no heic/heif)                                     |
| 12  | No backend        | By design                                      | The browser talks straight to the configured API origin (default `https://api.deepseek.com`); no server-side relay |

> To be clear: **the hard limits live on the server**. The lowest `safety_check` value is `low` (the docs state that omitting the field equals `low`) and there is no "off"; the model's own alignment is also not something a front end can change. This fork simply opens up everything the **client** can control.

---

---

[← 返回 README](../../README.md) · [全部文档](README.md)
