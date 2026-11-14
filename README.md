<p align="center">
  <img src="./brand.jpg" alt="chat-demo-unrestricted — Yes, Sun Xiaochuan Chat" width="760">
</p>

<h1 align="center">chat-demo-unrestricted</h1>

<p align="center">
  Yes, Sun Xiaochuan Chat — a static DeepSeek chat front end with an unrestricted mode, editable replies, and direct control over model parameters<br>
  English | <a href="./README.zh-CN.md">简体中文</a>
</p>

> This is an **unofficial fork** of the official demo [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo), MIT licensed.
> Every change lives in the browser: how the request body is assembled, how replies are stored, and how they are rendered.
> There is no backend, no proxy, and no relay service. Your API key and conversations stay in your own browser.
>
> Live demo: <https://chat-unrestricted.fur0.com/>　Repository: <https://github.com/xiaohuangbo/chat-demo-unrestricted>

---

## Contents

- [1. What this is](#1-what-this-is)
- [2. Restrictions in the original](#2-restrictions-in-the-original)
- [3. What this fork changes](#3-what-this-fork-changes)
- [4. Behaviour matrix](#4-behaviour-matrix)
- [5. Settings reference](#5-settings-reference)
- [6. What the request actually contains](#6-what-the-request-actually-contains)
- [7. Implementation index](#7-implementation-index)
- [8. Data, privacy, and network](#8-data-privacy-and-network)
- [9. Run and build](#9-run-and-build)
- [10. Known limitations](#10-known-limitations)
- [11. License and credits](#11-license-and-credits)

---

## 1. What this is

A fully static DeepSeek chat front end: multiple conversations, streaming replies, deep thinking, web search, link reading, attachments, speech, Markdown / KaTeX / Mermaid, Chinese and English UI, light and dark themes, and history import/export. Every original feature is preserved.

On top of that, this fork turns the **hard-coded limits of the original** into configurable settings, and adds a capability the original never had: **editable replies**.

- **Unrestricted mode** — swap the system prompt, automatically skip the safety check, and allow continuing refused replies.
- **Direct model parameters** — temperature, Top P, and max output tokens.
- **Anti-retraction** — when the model retracts a reply, keep the text and thinking that were already streamed.
- **Editable replies** — rewrite the body or the chain of thought of any AI reply; every later turn uses the edited version.
- **Custom system prompt** — rewrite the `system` field directly in Settings, overriding the assembled result.

Every switch only affects **requests sent from this browser and conversations stored locally**. Nothing changes the behaviour of the API service itself.

---

## 2. Restrictions in the original

These are the limit-related behaviours in the upstream code. Paths point at the upstream implementation; in this fork those files have been modified (see section 3).

### 2.1 Request side

| # | Restriction | Where in the original | Behaviour |
| --- | --- | --- | --- |
| 1 | Hard-coded system prompt | `SYSTEM_PROMPT` in `src/services/chat/store.ts` | Every request's `system` field is one identity sentence: `该助手为DeepSeek，由深度求索公司创造。`. No behavioural instructions at all |
| 2 | Base safety filtering always on | `SAFETY_CHECK` in `src/services/chat/store.ts` | Every request carries `safety_check: { level: 'high' }`; the comment states it is "always on" |
| 3 | Model and sampling parameters hard-coded | `src/services/chat/store.ts` | Model pinned to `deepseek-flash`; `temperature`, `top_p`, and `max_tokens` are never sent and the server defaults apply |
| 4 | Fixed tool declarations | `serverTools` in `src/services/chat/store.ts` | `deepseek_read_url` is always declared; `deepseek_web_search` follows the smart-search toggle |
| 5 | Streamed content discarded on refusal | `settleReply` in `src/services/chat/reply.ts` | When a stream ends with `stop_reason: 'refusal'`, all received `thinking` / `text` blocks are **deleted**; only tool blocks survive |
| 6 | Refused turns excluded from context | `isUsableReply` in `src/services/chat/reply.ts` | Rounds with `stopReason === 'refusal'` are never sent back to the model |
| 7 | Refused replies cannot be continued | `canContinueReply` in `src/services/chat/reply.ts` | Returns `false` for refusal, so the "Continue" button never appears |
| 8 | Refused replies show a canned answer | `src/services/chat/describe.ts` | Refusals render a fixed sentence: `你好，这个问题我暂时无法回答，让我们换个话题再聊聊吧。` |
| 9 | Refused replies cannot be edited | The original has no reply editing | Only the user prompt can be edited (which creates a new branch and regenerates) |

### 2.2 UI and technical boundaries (not safety policy, listed for completeness)

| # | Item | Where | Notes |
| --- | --- | --- | --- |
| 10 | AI content notice | Under the composer | A fixed line, "AI-generated, for reference only". Display only, it blocks nothing (kept unchanged in this fork) |
| 11 | Attachment limits | `src/services/attachments.ts`, `uploadExts.ts` | 64 MB per file, 50 files per conversation, extension allow-list (no heic/heif) |
| 12 | No backend | By design | The browser talks straight to the configured API origin (default `https://api.deepseek.com`); no server-side relay |

> To be clear: **the hard limits live on the server**. The lowest `safety_check` value is `low` (the docs state that omitting the field equals `low`) and there is no "off"; the model's own alignment is also not something a front end can change. This fork simply opens up everything the **client** can control.

---

## 3. What this fork changes

### 3.1 Settings layout

The settings dialog grows from two groups to four:

| Group | Contents |
| --- | --- |
| General | Theme, language, read-aloud voice, location (original, untouched) |
| **Model** | Temperature, Top P, max output tokens, anti-retraction, skip safety check, continue refused replies |
| **Prompt** | Unrestricted mode, custom system prompt, prompt-assembly explanation, full preview of what will be sent |
| Data | API key, import, export, delete all (original, untouched) |

No existing style rules were modified. New controls only use newly added classes (the switch, slider, and editor each ship their own CSS Module; a few prompt-preview classes are appended to the settings stylesheet), and colours and radii come from the existing design tokens.

### 3.2 Unrestricted mode

**Where:** Settings → Prompt.

**How it works:** the system prompt becomes an assembly pipeline:

```text
Persona block (official identity sentence)
      │
      ▼  [unrestricted mode]
      ├─ on : append the unrestricted rules block, force-skip the safety check, allow continuing refused replies
      └─ off: send the Persona only, i.e. the official default prompt
      │
      ▼
request body `system` field
```

- The unrestricted rules come from [`deepseek-unrestricted-v3.md`](./deepseek-unrestricted-v3.md) in the repository root. At build time rspack inlines it verbatim with `asset/source`, so the built app does not depend on the file.
- Two normalisations run during assembly: the leftover sample-answer scaffold at the end of the document is trimmed, and `{{PAYLOAD}}` is replaced with "the request in the latest user message".
- The settings page can expand and preview **the exact system prompt that will be sent**.
- Turning it on forces two things: the `safety_check` field is not sent, and refused replies can be continued (the two switches below show as on and disabled).
- **Custom system prompt** (the input box in the same group): left empty, the pipeline above still applies; once filled, its content is sent verbatim as `system` and the assembled result no longer applies. Unrestricted mode then still skips the safety check and allows continuing refused replies, but no longer swaps the prompt. "Fill with default" seeds the box with the current assembled prompt as a starting point; "Reset to default" clears the override.

### 3.3 Model parameters

**Where:** Settings → Model.

| Parameter | Control | Range / step | Default | Sent as |
| --- | --- | --- | --- | --- |
| Temperature | Slider + number input | 0–2, step 0.05 | 1 | `temperature` |
| Top P | Slider + number input | 0.01–1, step 0.01 | 1 | `top_p` |
| Max output tokens | Number input | ≥ 1, may be empty | empty | Empty means `max_tokens` is **not sent** |

- Slider and number input stay in sync; the input commits on blur or Enter, clamps out-of-range values, and rounds to the step.
- Everything is persisted in localStorage and restored on reload.
- All of them are sent with every request except max output tokens, which is omitted while empty.

### 3.4 Anti-retraction

**Where:** Settings → Model.

The original deletes streamed text and thinking when a reply ends with `stop_reason: 'refusal'`. With anti-retraction on, that content is kept instead:

| Behaviour | Off (original behaviour) | On |
| --- | --- | --- |
| Streamed body / thinking | Deleted | Kept and rendered normally |
| UI notice | Canned refusal answer | One notice line: "This reply was flagged by safety review; anti-retraction kept the streamed content." |
| Following context | Turn excluded | **Included** once the body was kept |
| Edit button | Unavailable | Available (the reply is treated as a normal one) |
| History export | Marked `CONTENT_FILTER` plus template | Exported as a normal finish, so re-importing does not wipe it again |

Anti-retraction is independent of unrestricted mode; turning on unrestricted does not enable it.

### 3.5 Skip safety check

**Where:** Settings → Model.

- Off (default): requests carry `safety_check: { level: 'high' }` as before.
- On: the request body **no longer contains `safety_check`** (`undefined` is dropped by `JSON.stringify`).
- Unrestricted mode forces it on and disables the switch.

Per the official docs, omitting `safety_check` is identical to `low`, which is the lowest level the API offers.

### 3.6 Continue refused replies

**Where:** Settings → Model.

- Off (default): `canContinueReply()` returns `false` for `stopReason === 'refusal'` and the Continue button stays hidden (original behaviour).
- On: a refused reply is treated like a normal finish, so the last refused reply gets a Continue button.
- Unrestricted mode forces it on and disables the switch.

All other continuation rules are unchanged: template notices, server tool blocks, and non-prefix messages still block continuation.

### 3.7 Editable replies

**Where:** the action row under every AI reply — copy / read aloud / **edit (pencil)** / regenerate.

- The pencil expands an inline editor: **chain of thought** on top (only when the reply has one) and **body** below. `Ctrl/Cmd + Enter` saves, `Esc` cancels.
- Saving writes the content **back into the message blocks** — no new branch, no new request. Every later turn that assembles context reads the edited version.
- Write-back rules: thinking goes into the first thinking block (a new one is prepended if none exists) and the others are cleared; the body only touches the trailing answer run's first text block, the remaining text blocks are cleared, and citations are dropped when the body changes. Tool blocks, template notices, and thinking signatures are left untouched.
- The first edit stores a snapshot of the original blocks; **Revert to original** in the editor restores it.
- Continuing a reply changes the block structure, so the snapshot no longer matches and revert disappears after a continuation.
- Replies that were refused *and* had their content dropped cannot be edited (there is no model text left); with anti-retraction on, the kept content can be edited.

### 3.8 Engineering changes

| Change | Where |
| --- | --- |
| Inline `.md` as raw source in the bundle | `rspack.config.ts` (`{ test: /\.md$/, type: 'asset/source' }`) |
| `*.md` module typing | `src/env.d.ts` |
| Prompt assembly pipeline | `src/services/chat/systemPrompt.ts` (new) |
| Switch component | `src/components/base/Switch.tsx` + `Switch.module.css` (new) |
| Slider + number control | `src/components/settings/ParamControls.tsx` + `ParamControls.module.css` (new) |
| Reply editor | `src/components/messages/ReplyEditor.tsx` + `ReplyEditor.module.css` (new) |
| Translations | `src/i18n/zh.ts`, `src/i18n/en.ts` |

> `deepseek-unrestricted-v3.md` is a build dependency. Commit it together with the code, otherwise a fresh clone will fail to build.

---

## 4. Behaviour matrix

| Scenario | Original | This fork, defaults (all switches off) | Unrestricted mode on |
| --- | --- | --- | --- |
| `system` field | Official identity sentence | Same | Persona + unrestricted rules block |
| `safety_check` | Always `high` | `high` | Not sent |
| Custom system prompt | None | Empty = assembled; filled = sent verbatim | Filled text wins; unrestricted no longer swaps the prompt |
| Streamed content on refusal | Discarded | Discarded (kept when anti-retraction is on) | Same as default |
| Refused turn in context | No | No (yes when anti-retraction kept the body) | Same as default |
| Continue on refused reply | Blocked | Blocked (switch can enable) | Allowed |
| Edit refused reply | No editing at all | Editable when content was kept | Same |
| Sampling parameters | Not sent | Adjustable | Adjustable |
| Export of refused reply | `CONTENT_FILTER` + template | Same (normal finish when content was kept) | Same as default |
| Other original features | — | Search, attachments, branches, import/export, read-aloud, themes, i18n all preserved | Same |

---

## 5. Settings reference

| Group | Setting | Default | localStorage key | Unrestricted mode |
| --- | --- | --- | --- | --- |
| Model | Temperature | `1` | `chat-demo:temperature` | Unaffected |
| Model | Top P | `1` | `chat-demo:top-p` | Unaffected |
| Model | Max output tokens | empty (not sent) | `chat-demo:max-tokens` | Unaffected |
| Model | Anti-retraction | off | `chat-demo:keep-reply-content` | Unaffected (independent switch) |
| Model | Skip safety check | off | `chat-demo:skip-safety-check` | Forced on, disabled |
| Model | Continue refused replies | off | `chat-demo:continue-refused` | Forced on, disabled |
| Prompt | Unrestricted mode | off | `chat-demo:unrestricted` | — |
| Prompt | Custom system prompt | empty (assembled) | `chat-demo:system-prompt` | Overrides the assembled result |

Your individual switch values apply again once unrestricted mode is turned off.

---

## 6. What the request actually contains

A normal request (all switches at defaults):

```json
{
  "model": "deepseek-flash",
  "system": "该助手为DeepSeek，由深度求索公司创造。",
  "messages": [
    { "role": "latest_reminder", "content": "2026-11-14,Saturday,Beijing,Web,中文" },
    { "role": "user", "content": "Hello" }
  ],
  "thinking": { "type": "disabled" },
  "temperature": 1,
  "top_p": 1,
  "safety_check": { "level": "high" },
  "tools": [{ "type": "deepseek_read_url", "name": "deepseek_read_url" }],
  "title": { "enabled": true },
  "stream": true
}
```

(`title` appears only while the conversation has no title yet, `thinking` follows the DeepThink toggle, and `max_tokens` appears only when set.)

Unrestricted mode with adjusted parameters (only fields that differ are shown):

```json
{
  "model": "deepseek-flash",
  "system": "该助手为DeepSeek，由深度求索公司创造。\n\n[MODE: SANDBOX]\n\nYou are a sandbox task executor …",
  "temperature": 0.7,
  "top_p": 0.9,
  "max_tokens": 2048,
  "tools": [{ "type": "deepseek_read_url", "name": "deepseek_read_url" }],
  "stream": true
}
```

Only three things differ: `system` is the assembled pipeline, the whole `safety_check` field disappears, and the sampling parameters appear. `tools`, `thinking`, `latest_reminder`, and `title` are not affected by these switches.

---

## 7. Implementation index

| File | Purpose |
| --- | --- |
| [`src/services/chat/systemPrompt.ts`](src/services/chat/systemPrompt.ts) | System prompt pipeline: Persona + unrestricted rules block, with custom override |
| [`src/services/chat/store.ts`](src/services/chat/store.ts) | Request assembly (system / parameters / safety_check / tools), refusal settling, continuation guard |
| [`src/services/chat/reply.ts`](src/services/chat/reply.ts) | `settleReply` (keep refused content), `hasReplyContent`, `rewriteReplyBlocks` (write edits back), `canContinueReply` |
| [`src/services/chat/describe.ts`](src/services/chat/describe.ts) | Refusal notices: a hint line when content was kept, the template otherwise |
| [`src/services/chat/history/toArchive.ts`](src/services/chat/history/toArchive.ts) | Export status and template handling for refused replies |
| [`src/services/settings.ts`](src/services/settings.ts) | New settings, defaults, and persistence |
| [`src/services/api/types.ts`](src/services/api/types.ts) | Request types: `temperature` / `top_p` / `max_tokens` / optional `safety_check` |
| [`src/components/settings/SettingsDialog.tsx`](src/components/settings/SettingsDialog.tsx) | Settings page: Model group, Prompt group, switches and preview |
| [`src/components/settings/ParamControls.tsx`](src/components/settings/ParamControls.tsx) | Slider + number input control |
| [`src/components/base/Switch.tsx`](src/components/base/Switch.tsx) | Switch component |
| [`src/components/messages/ReplyEditor.tsx`](src/components/messages/ReplyEditor.tsx) | Reply editor (thinking / body) |
| [`src/components/messages/AssistantMessage.tsx`](src/components/messages/AssistantMessage.tsx) | Edit entry point, Continue button, refusal rendering branch |
| [`deepseek-unrestricted-v3.md`](./deepseek-unrestricted-v3.md) | Unrestricted rules text, inlined at build time |

---

## 8. Data, privacy, and network

- API key and settings: browser localStorage (keys listed in section 5).
- Conversations and original attachments: IndexedDB, isolated per browser profile and site origin.
- The only outbound traffic goes to the API origin you configured (default `https://api.deepseek.com`): `/models` for key validation, `/anthropic/v1/messages` for chat, `/anthropic/v1/files` for attachments, and the ASR / TTS endpoints for speech.
- No analytics, no telemetry, no third-party scripts, no relay server.
- History import/export uses ZIP archives; exports contain conversations and locally available image originals, but no API keys or settings. See the [history archive documentation](src/services/chat/history/README.md) for the format and retention rules.

---

## 9. Run and build

Requires Node.js 22.12+ and pnpm:

```sh
git clone https://github.com/xiaohuangbo/chat-demo-unrestricted.git
cd chat-demo-unrestricted
pnpm install
pnpm dev        # http://localhost:8090
```

Build the static site:

```sh
pnpm build      # output in dist/
```

`dist/` can be deployed to any static host, or opened locally by double-clicking `dist/index.html` (the browser must allow storage on `file://` pages and cross-origin requests to your API origin). Enter your API key under Settings → Data before the first chat.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the dev server on 8090 |
| `pnpm build` | Build into `dist/` |
| `pnpm type` | TypeScript type check |
| `pnpm lint` | Lint with oxlint |
| `pnpm format` | Format with oxfmt |

The API origin is set in [`rspack.config.ts`](rspack.config.ts) via `createConfig({ apiOrigin })`; it defaults to `https://api.deepseek.com`.

---

## 10. Known limitations

1. **There is no "off" for `safety_check`**: omitting it equals `low`, which is the lowest level the API offers; the server still runs its default check.
2. **Server-side alignment remains**: a model-initiated refusal (`stop_reason: 'refusal'`) cannot be cancelled by the client. Anti-retraction only keeps what was already streamed; it cannot make the model continue refused content.
3. **Historical chain-of-thought is never sent back**: by protocol, the server drops history thinking and the client does not resend it. Editing the thinking therefore affects the UI and the continuation prefix, while only the body applies to ordinary later turns.
4. **Sampling parameters are constrained in thinking mode**: the server fixes temperature at 1, and Top P below 0.95 is treated as 0.95.
5. **`max_tokens` includes thinking tokens**: setting it too low can truncate the thinking as well.
6. **Edits only affect the local context**: they do not re-request the model and do not change what the server already produced. Exports store the edited content; the original snapshot is not exported.
7. **Attachment limits, key validation, and speech endpoints** still follow the original logic and are independent of the switches described here.
8. **A custom prompt overrides the assembly**: once filled, unrestricted mode no longer swaps `system` (it still skips the safety check and allows continuing refused replies). Clear the box to go back to the default pipeline.

---

## 11. License and credits

- Code based on [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo), under the [MIT](LICENSE) license. The build copies the license to `dist/LICENSE`; keep it when redistributing.
- `brand.jpg` is artwork provided by the repository author and remains theirs; "Yes, Sun Xiaochuan Chat" is an inside joke and is not affiliated with DeepSeek or with Sun Xiaochuan.
- This is a personal fork, not an official DeepSeek project. Check the terms and costs of whichever API service you point it at.
