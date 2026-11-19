## 6. 请求体实际内容

普通请求（全部开关默认）：

```json
{
  "model": "deepseek-flash",
  "system": "该助手为DeepSeek，由深度求索公司创造。",
  "messages": [
    { "role": "latest_reminder", "content": "2026-11-14,星期六,北京市,Web,中文" },
    { "role": "user", "content": "你好" }
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

（`title` 只在这条会话还没有标题时出现，`thinking` 跟随输入框的深度思考开关，`max_tokens` 仅在设置后出现。）

开启自定义思维链后，`system` 在 Persona / 破限规则与记忆、搜索上下文之间追加 `[自定义思维链]` 分块；深度思考开启时换成 `[自定义思维链 · 实验性]`。首轮同时带 `title` 也会注入，其余字段与消息结构不变。关闭深度思考时，客户端在回复上方额外渲染「已注入思维链」卡片；该卡片不进入请求，也不写入 `blocks`。

开启搜索投毒并接管时，`tools` 只剩 `deepseek_read_url`，`system` 末尾追加 `[LOCAL SEARCH LAYER]` 搜索上下文，`latest_reminder` 使用自定义日期与位置；关闭接管或没有自定义结果时仍保持上面的真实搜索请求。

附件投毒只改变上传到 Files API 的文件字节，不改变请求体结构；附件仍以 `file_id` 引用。

开启浏览器工具 / 工作区后，`tools` 追加客户端工具定义（名称、说明与参数 schema），模型返回 `tool_use` 时由页面本地执行，再把结果作为 `tool_result` 追加到下一轮请求：

```json
{
  "tools": [
    { "type": "deepseek_read_url", "name": "deepseek_read_url" },
    {
      "name": "get_weather",
      "description": "查询城市天气（Open-Meteo，无需 API Key）…",
      "input_schema": { "type": "object", "properties": { "location": { "type": "string" } } }
    }
  ],
  "messages": [
    { "role": "latest_reminder", "content": "2026-11-18,星期二,北京市,Web,中文" },
    { "role": "user", "content": "杭州今天热吗" },
    {
      "role": "assistant",
      "content": [
        {
          "type": "tool_use",
          "id": "toolu_1",
          "name": "get_weather",
          "input": { "location": "杭州" }
        }
      ]
    },
    {
      "role": "user",
      "content": [{ "type": "tool_result", "tool_use_id": "toolu_1", "content": "地点：杭州…" }]
    }
  ]
}
```

客户端工具往返最多 4 轮，每轮都是一次独立请求（token 按轮计费）；工具调用与结果不进历史上下文，导出包也不含工具卡片。

越狱模式 + 调过参数（只列与上一例不同的字段）：

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

差异只有三处：`system` 换成组装后的流水线、`safety_check` 整个字段消失、多了采样参数。开启思考强度后，`thinking` 变成 `{ "type": "enabled", "budget_tokens": 4096 }` 并额外带 `reasoning_effort`；服务端拒绝时这两个字段会被自动去掉后重试。`tools`、`thinking`、`latest_reminder`、`title` 都不受这两个开关影响。

---

---

[← 返回 README](../../README.md) · [全部文档](README.md)
