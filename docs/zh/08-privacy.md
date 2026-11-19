## 8. 数据、隐私与网络

- API Key、各项设置：浏览器 localStorage（键名见第 5 节）；
- 搜索投毒配置（时间、替换 / 过滤规则、自定义结果）只存 localStorage，启用后会作为 system 上下文发送给你配置的 API 地址；
- 附件投毒配置只存 localStorage；原始附件在本机，上传的是处理后的副本，伴随文本附件会作为普通文件随消息发送；
- 会话与附件原件：IndexedDB，按浏览器用户配置与站点源隔离；
- 出站请求只有你配置的 API 地址：默认是 DeepSeek（`https://api.deepseek.com`，`/models` 校验 Key、`/anthropic/v1/messages` 对话、`/anthropic/v1/files` 附件、ASR / TTS 语音接口）；启用自定义 OpenAI 兼容提供商后，对话与 Key 校验发往你自己配置的 Chat Completions 端点（附件以内联方式随请求体发送，语音相关接口仍指向 DeepSeek，因此该模式下不可用）；
- 浏览器工具 / 工作区：开关在 localStorage；工作区文件默认在 `chat-demo:workspace`，切到 OPFS 后改存到站点私有的 `chat-demo-workspace/` 目录（浏览器分配、其它站点无法访问）；工具结果与产物随回复写入 IndexedDB；
- 统计：`chat-demo:usage-ledger`、`chat-demo:context-usage`、`chat-demo:context-breakdown` 只存聚合数字，不含对话正文；
- 工具会向第三方服务发起请求：Open-Meteo（天气）、BigDataCloud（逆地理）、你让 Agent 抓取的网页；其余工具都在本地完成；
- 没有统计、没有埋点、没有第三方脚本、没有中转服务器；
- 历史导入导出为 ZIP，导出包含会话与本地图片原件，不包含 API Key 与设置；归档格式与保留范围见[历史导入导出说明](../../src/services/chat/history/README.md)。

---

---

[← 返回 README](../../README.md) · [全部文档](README.md)
