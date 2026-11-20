<p align="center">
  <img src="./brand.jpg" alt="chat-demo-unrestricted — 是，孙笑川聊天" width="760">
</p>
<h1 align="center"><img src="brand_2.jpg" alt="你应该放弃这世间所有的C端客户端，来体验宇宙最强对抗路神作，这是你唯一和顶级开源模型厮杀的机会" width="250"></h1>

<h1 align="center">deepseek unrestricted chat harness</h1>

<p align="center">
  deepseek unrestricted chat harness —— 基于 DeepSeek API 的静态聊天前端，带解除限制模式、回复改写与参数直调<br>
  <a href="./README.md">English</a> | 简体中文
</p>

> 本项目是官方示例 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 的**非官方修改版**（fork），MIT 许可。
> 所有改动都在浏览器里完成：请求体怎么拼、回复怎么存、界面怎么显示。没有代理、没有中转服务，
> API Key 与对话记录仍只保存在你自己的浏览器里。
>
> 🔗在线版：<https://chat-unrestricted.fur0.com/>
>
> 📦仓库：<https://github.com/xiaohuangbo/chat-demo-unrestricted>
>
> 🎥介绍视频：<https://www.bilibili.com/video/BV1m3s66WESg/>
>
> 📚参考论文：<https://arxiv.org/pdf/2403.12171>

<p align="center">
  <img src="./Demo%20Picture.png" alt="聊天界面演示：解除限制模式下的技术问答" width="860">
</p>

---

## 本仓库新增了什么

- **解除限制与提示词工程**：越狱模式、系统提示词预设、每轮注入、中文越狱提示词、自定义思维链；
- **浏览器 Agent 工具**（默认关闭，逐项开关）：时间、定位、天气、通知、剪贴板、抓网页、生成文件、打开链接、可视化组件；
- **虚拟工作区**：浏览器本地文件库，任意格式导入导出、OPFS 真文件系统、安卓端为应用存储；
- **NanoVM Slim**：内置 WASM Shell Engine 与 81 个 busybox 命令，桌面端右侧停靠、手机端底部面板，Python / Node.js / Git 按需安装；
- **聊天模式**：仅聊天 / 网页 Agent / PTC / 创造，决定下发哪些客户端工具与往返上限；
- **统计与计费**：用量账本、上下文分类、按模型计费、服务端搜索免费开关；
- **安卓端**：APK 构建、应用内更新检测、虚拟机联网内置代理。
- **BYOK / OpenAI 兼容提供商**：把应用指向任何兼容 Chat Completions 协议的端点并使用你自己的 Key，Key 只存本机浏览器。

## 文档导航

README 已经拆成 `docs/zh/` 下的分册，首页只保留简介与入口；英文文档在 [`docs/en/`](docs/en/README.md)。

| 章节                  | 内容                                                    | 文件                                                   |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| 1. 这是什么           | 项目定位、原版功能与本仓库新增的能力清单                | [01-what-is-this.md](docs/zh/01-what-is-this.md)       |
| 2. 原版做了哪些限制   | 请求侧与界面侧被写死的地方                              | [02-original-limits.md](docs/zh/02-original-limits.md) |
| 3. 本仓库做了哪些改动 | 3.1–3.27：设置页每一组功能、NanoVM Slim、聊天模式的细节 | [03-changes.md](docs/zh/03-changes.md)                 |
| 4. 行为对照表         | 原版 / 默认 / 越狱模式逐项对比                          | [04-behaviour.md](docs/zh/04-behaviour.md)             |
| 5. 设置项速查         | 每一项的默认值与 localStorage 键名                      | [05-settings.md](docs/zh/05-settings.md)               |
| 6. 请求体实际内容     | 实际发出去的 JSON 长什么样                              | [06-request.md](docs/zh/06-request.md)                 |
| 7. 实现位置索引       | 每个能力对应的源码文件                                  | [07-implementation.md](docs/zh/07-implementation.md)   |
| 8. 数据、隐私与网络   | 数据都存在哪、请求发往哪里                              | [08-privacy.md](docs/zh/08-privacy.md)                 |
| 9. 运行与构建         | 开发、构建与 Android APK 打包                           | [09-build.md](docs/zh/09-build.md)                     |
| 10. 已知限制          | 51 条边界与取舍                                         | [10-known-limits.md](docs/zh/10-known-limits.md)       |
| 11. 许可与致谢        | MIT 许可与上游                                          | [11-license.md](docs/zh/11-license.md)                 |

## BYOK：OpenAI 兼容提供商

默认情况下，本应用使用你在「设置 → 数据管理」中填写的 Key 直接请求 DeepSeek API（Anthropic 兼容协议）。你也可以把所有对话流量指向**任何兼容 OpenAI Chat Completions 协议的端点**——OpenAI、OpenRouter、Groq、Together、DeepSeek、llama.cpp、Ollama（`http://localhost:11434/v1`）、vLLM 等。

设置 → 数据管理 → **OpenAI / 自定义兼容提供商**：

1. 点击「使用 OpenAI 默认配置」自动填入 `https://api.openai.com/v1` 并建议使用 `gpt-4o-mini`，然后填写你的 **API Key** 和模型 id。也可以手动配置其他兼容端点（缺少 `/v1` 后缀会自动补上）。
2. 使用「获取模型列表」按钮（调用 `GET {base}/models`），或直接输入模型 id。
3. 「测试连接」用 `GET /models` 校验 Key，免费。
4. 打开「启用自定义提供商」。此后所有请求都以 `POST {base}/chat/completions` 发往你的端点；关闭开关即切回内置 DeepSeek API（DeepSeek 的 Key 会保留）。

说明：

- 自定义 Key 只保存在本浏览器的 localStorage（`chat-demo:custom-provider`）中，直接发送给你配置的端点，不经过作者或任何中转服务器。
- DeepSeek 专有的服务端能力（联网搜索、阅读链接、自动标题、`safety_check`）不会发送给自定义端点；智能搜索开关在此模式下被禁用。
- 附件以内联方式发送：图片（≤ 8 MB）以 base64 data URL 下发，文本类文件（≤ 512 KB）以原文下发；PDF/DOCX/PPT 等二进制文档会被跳过。
- 开启思考时透传 `reasoning_effort`；不支持的模型会忽略该字段。
- 浏览器工具不受影响（工具在本地执行，模型经 `tool_calls` 调用）；流式输出、上下文分类、用量账本正常工作（端点需返回 `usage` 字段，本应用会请求 `stream_options.include_usage`）。
- 关于 OpenRouter 的 `:free` 模型：限额较紧（约 20 次/分钟、50 次/天），部分模型仅限 agentic harness（编程智能体，返回 HTTP 403），会拒绝普通聊天客户端——请使用通用的免费模型，或付费版（如 `thinkingmachines/inkling-2-small`）。
- ChatGPT Plus/Pro 订阅登录不等同于 API Key。OpenAI 官方套餐共享流程需要获批的 Sign in with ChatGPT OAuth/PKCE 集成、后端或本地伴侣程序以及 Responses API；当前这个托管静态浏览器应用通过 API Key 使用 OpenAI。

## 快速开始

```sh
pnpm install
pnpm dev                       # 本地开发（http://localhost:8090）
pnpm build                     # 构建静态产物到 dist/
KS_PASS=<keystore密码> ./构建APK.sh   # 构建并签名 Android APK
```

完整说明（环境变量、签名、字体与离线细节）见 [9. 运行与构建](docs/zh/09-build.md)。

## 最近版本

- **2.6.9**：设置 → 关于新增「检查更新」（安卓端直接给 APK 链接）；修复终端光标残影；安卓端工作区改为应用存储语义并放宽配额；README 拆分为分册。
- **2.6.8**：NanoVM Slim（WASM shell + busybox + 按需工具链）、聊天模式四档、虚拟机联网（APK 内置反向代理）、切换输入法与红色重置。
- 更早的版本见应用内 **设置 → 更新日志**。

## Star 历史

<!-- star-history:start -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/star-history/star-history-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="assets/star-history/star-history-light.svg" />
  <img alt="Star History Chart" src="assets/star-history/star-history-light.svg" />
</picture>
<!-- star-history:end -->

## 许可

MIT，见 [11. 许可与致谢](docs/zh/11-license.md)。
