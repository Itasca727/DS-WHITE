# WHITE 长期记忆库 · 第一版

基于用户提供的 DS-WHITE-main.zip（2026-11-24 版）修改。保留原 MIT 许可证及作者署名，不修改原版 API 地址、模型选择、安全参数、环境提醒或官方基础系统提示词。

## 使用

- 设置 → 通用 → 长期记忆库 → 管理；也可以在聊天页右上角的上下文管理中点击「记忆库」。
- 默认全局开关关闭。先手动填写记忆并保存，或选择最近 10/30/50/100 轮，点击 AI 总结当前对话，审核草稿后再保存。
- AI 总结是一笔独立的 deepseek-flash API 请求，会产生费用。只使用当前分支未被排除的已完成对话文字；不会自动读取图片、附件原件或其他聊天窗口。输入超过 120000 字符时要求减少轮数。
- 每条可编辑、启用、停用或删除。开启总开关后，所有会话共享启用的记忆；请勿把不希望跨窗口共享的隐私内容启用。关闭后，本模块不追加任何内容。
- 单条上限 6000 字符，最多 200 条，同时启用的总长度 24000 字符；不是 token 数。每次聊天都会发送所有启用的记忆，可能增加 API 消耗。暂未做按相关性检索或自动定时总结。
- 记忆保存在本机浏览器 localStorage，单独通过 JSON 导出、导入；聊天 ZIP 和原自动备份不包含新记忆库。导入合并且新条目默认停用，不自动改动总开关。清理浏览器数据或换设备前请先导出。

## 提示词行为

`src/services/chat/store.ts` 原版 `SYSTEM_PROMPT` 保留为 `该助手为DeepSeek，由深度求索公司创造。`。

本模块关闭时 `memoryLibrarySystem()` 返回空字符串，不改变原请求。开启并存在启用条目时，在现有 system 后追加标记清楚的长期记忆。原有自动/手动压缩仍独立控制；若希望最接近官方 Demo，关闭新记忆库和原有压缩、不排除历史轮次。官方 APP 服务端的隐藏提示词仍无法由此验证。

## 运行/部署

需要 Node.js 22 和 pnpm 10。在解压后的项目根目录执行：

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

访问终端显示的本地地址（默认 http://localhost:8090）。原版 GitHub Pages 部署工作流保留：将项目上传到自己的 GitHub 仓库，Settings → Pages → Build and deployment → Source 选择 GitHub Actions，再运行 Deploy to GitHub Pages 工作流。不要提交 API Key、聊天记录、记忆 JSON 或其他个人数据。用自己的官方 API Key 在网页中设置。

## 测试状态

本次使用 TypeScript transpileModule 检查了七个新增或修改的 TS/TSX 文件的语法，使用本地模拟存储/模拟 API 流测试通过了记忆增删改、开关、导入去重、保存失败不更新状态、重新加载和 AI 草稿隔离流程。

环境无法访问 npm registry，未安装项目依赖，未执行完整类型检查、生产构建、浏览器 UI 实测或真实 DeepSeek API 联调。首次部署前请执行 `pnpm type`、`pnpm build` 和 `node tests/memory-library.test.cjs`，然后使用测试会话确认功能。此版本是可继续迭代的源码版本，不是已上线的网址。
