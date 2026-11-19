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

With custom chain of thought enabled, `system` gains a `[CUSTOM CHAIN OF THOUGHT]` block between the Persona / unrestricted rules and the memory / search context; with deep thinking on it becomes `[CUSTOM CHAIN OF THOUGHT · EXPERIMENTAL]`. The first request also carries `title`, and still gets the block; every other field and the message structure stay unchanged. With deep thinking off, the client additionally renders an “Injected chain of thought” card above the reply; the card is not part of the request and is not written into `blocks`.

With search poisoning enabled and takeover active, `tools` only keeps `deepseek_read_url`, `system` gains a `[LOCAL SEARCH LAYER]` block, and `latest_reminder` uses the custom date and location; with takeover off or no custom results the real-search request above is unchanged.

Attachment poisoning changes only the uploaded file bytes sent to the Files API, not the request shape; attachments are still referenced by `file_id`.

With browser tools or the workspace enabled, `tools` gains client tool definitions (name, description, input schema). When the model answers with `tool_use`, the page executes it locally and appends the result as a `tool_result` before the next request:

```json
{
  "tools": [
    { "type": "deepseek_read_url", "name": "deepseek_read_url" },
    {
      "name": "get_weather",
      "description": "Query city weather (Open-Meteo, no API key).",
      "input_schema": { "type": "object", "properties": { "location": { "type": "string" } } }
    }
  ],
  "messages": [
    { "role": "latest_reminder", "content": "2026-11-18,Tuesday,Beijing,Web,Chinese" },
    { "role": "user", "content": "Is it hot in Hangzhou today?" },
    {
      "role": "assistant",
      "content": [
        {
          "type": "tool_use",
          "id": "toolu_1",
          "name": "get_weather",
          "input": { "location": "Hangzhou" }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        { "type": "tool_result", "tool_use_id": "toolu_1", "content": "Location: Hangzhou..." }
      ]
    }
  ]
}
```

Client tool round trips are capped at four per reply and each round is a separate request (billed per round). Tool calls and results never become part of the replayed history, and exports do not include tool cards.

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

---

[← 返回 README](../../README.md) · [全部文档](README.md)
