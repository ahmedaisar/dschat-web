## 8. Data, privacy, and network

- API key and settings: browser localStorage (keys listed in section 5).
- Search-poison settings (time, replacement / filter rules, custom results) live only in localStorage; when enabled they are sent as system context to the API origin you configured.
- Attachment-poison settings live only in localStorage; original attachments stay on this device, the processed copies are uploaded, and companion text attachments are sent as ordinary files.
- Conversations and original attachments: IndexedDB, isolated per browser profile and site origin.
- The only outbound traffic goes to the API origin you configured: DeepSeek by default (`https://api.deepseek.com`: `/models` for key validation, `/anthropic/v1/messages` for chat, `/anthropic/v1/files` for attachments, and the ASR / TTS endpoints for speech), or — with the custom OpenAI-compatible provider enabled — the Chat Completions endpoint of your choice (`/models` for key validation, `/chat/completions` for chat; attachments are inlined into the request body, speech and ASR still target the DeepSeek origin and are therefore unavailable there).
- Browser tools / workspace: switches live in localStorage; workspace files default to `chat-demo:workspace` (binary stored as base64, roughly a third larger), and in OPFS mode live as raw bytes under the origin-private `chat-demo-workspace/` directory (inaccessible to other sites); tool results / artifacts go into IndexedDB with the reply.
- Statistics: `chat-demo:usage-ledger`, `chat-demo:context-usage` and `chat-demo:context-breakdown` store aggregate numbers only, never message text.
- Tools reach third parties only where the capability requires it: Open-Meteo (weather), BigDataCloud (reverse geocoding), and whatever page the agent is told to fetch; everything else runs locally.
- No analytics, no telemetry, no third-party scripts, no relay server.
- History import/export uses ZIP archives; exports contain conversations and locally available image originals, but no API keys or settings. See the [history archive documentation](../../src/services/chat/history/README.md) for the format and retention rules.

---

---

[← 返回 README](../../README.md) · [全部文档](README.md)
