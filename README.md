# DS WHITE

一个只为你亮着的对话窗口。基于 DeepSeek API 的对话 PWA：打开即用，手机、电脑都能装。

**在线使用**：https://christinemal721-spec.github.io/DS-WHITE/

## 开始使用

### 直接打开

打开上面的链接，在「设置 › 数据管理」里填入你自己的 DeepSeek API Key 即可。

- API Key 只保存在你自己的设备上，不会上传到任何地方，导出的备份里也不包含它。
- 每个人使用自己的 Key，费用各自结算。

### 装到主屏幕或桌面

| 设备 | 操作 |
| --- | --- |
| iPhone / iPad | 用 Safari 打开 › 分享 › 添加到主屏幕 |
| 安卓 | 用 Chrome 打开 › 右上角菜单 › 安装应用（或「添加到主屏幕」） |
| 电脑 | 用 Chrome / Edge 打开 › 地址栏右侧的「安装」图标 |

### 设备差异

- 界面主要按 iPhone 打磨，安卓和电脑同样可用。
- 震动反馈仅在手机上有。
- 自动备份「静默覆盖文件」仅支持电脑版 Chrome / Edge；其他设备在备份完成后点一下存到文件。

## V1.0 特色功能

- **全量交接官端历史**：直接导入 DeepSeek 官方导出的历史对话 ZIP，对话、图片原件和重新生成的各个版本原样迁入；导出为同一格式；覆盖导入前自动留快照；可开启每 10 轮自动备份。
- **API 用量一键跳转**：在设置里查询账户余额，一键前往充值。当前仅支持查询跳转 DeepSeek API，但不影响其他模型使用。
- **上下文 1M 不断片**：逐轮管理哪些对话进入请求，可手动压缩最早 N 轮；开启自动压缩后，接近 1M token 上限时先由模型整理摘要再继续。
- **搜索对话**：独立的搜索页从按钮原地展开，关键词高亮，结果日期精确到日，边缘右滑返回。
- **按轮删除对话**：长按任意消息进入多选，整轮删除（含重新生成的版本），后面的对话自动接上；上下文管理、摘要、导出与搜索同步更新。
- **交互反馈**：统一的「冷光浮现」开合动效、触感与轻音效、按钮冷光涟漪、跟手滑动、开屏签名接力。
- **更多细节**：五档字体、朗读音色「暗潮」、语音输入后自动恢复扬声器音量、深浅双主题、深度思考自动折叠、离线可打开。

## 自己部署一份

不需要服务器，任选一种：

- **GitHub Pages**：Fork 本仓库 › Settings › Pages › Source 选「GitHub Actions」。之后每次推送到 `main` 都会自动构建发布，地址为 `https://你的用户名.github.io/DS-WHITE/`。
- **Vercel / Cloudflare Pages / Netlify**：导入仓库，构建命令填 `pnpm build`，输出目录填 `dist`。

必须使用 HTTPS 访问，才能离线使用和安装到主屏幕。

## 本地开发

需要 Node.js 22.12+ 和 pnpm：

```sh
pnpm install
pnpm dev      # 打开 http://localhost:8090
pnpm build    # 产物在 dist/
```

## 致谢与版权

本项目基于 DeepSeek 开源的 [chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT License）修改而来，`LICENSE` 中保留了原版权声明。

开发工具：DeepSeek Harness · DeepSeek · Claude · Python。各标志版权归其各自所有者。

版权所有 DeepSeek，欢迎继续开发功能、沟通交流，请勿直接商用。
Copyright DeepSeek. You are welcome to keep developing features and to get in touch; please do not use it commercially as-is.
