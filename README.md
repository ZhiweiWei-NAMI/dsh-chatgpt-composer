# dsh-chatgpt-composer · Mirror

DSH 0.2.1-rc.2 的 ChatGPT 聊天卡片与 Mirror 历史阅读视图。当前版本：`0.2.1-mirror.6`。

## 安装

在 DSH 的插件管理中安装 npm 包 `dsh-chatgpt-composer@0.2.1-mirror.6`，或从 [GitHub Releases](https://github.com/ZhiweiWei-NAMI/dsh-chatgpt-composer/releases) 下载对应 `.tgz` 安装包。也可使用 CLI：

```sh
dsh plugin --profile desktop add dsh-chatgpt-composer@0.2.1-mirror.6
```

安装或更新后完整退出并重新打开 DSH，使宿主与前端版本一致。需要本机已有 Edge、Chrome 或 Chromium；插件使用独立的持久化浏览器资料，不读取个人浏览器的登录凭据。

## 使用

- 在原聊天输入框右侧的 ChatGPT 卡片中选择本机调试端口，打开专用浏览器并手动登录 ChatGPT。账户资料、端口配置和连接状态只在该卡片中管理。
- 卡片显示真实头像、用户名和最近最多 20 条聊天；历史按批次缓存，不持续扫描或滚动页面。
- 历史菜单中的“插入上下文”将实际会话正文生成为 Markdown 附件，通过 DSH 原生附件流程插入当前 DSH 会话。
- 同一菜单中的“跳转聊天”打开 Mirror 对应会话。Mirror 使用独立主面板与全局侧栏底部历史区，不替换 DSH 工作区。
- Agent 可使用 `chatgpt_chats` 列出历史，使用 `chatgpt_read` 读取会话。

Mirror 是原插件内的视图，不是可并装的第二个连接插件。它共用原 `chatgptComposer` 接口、同一浏览器、资料目录、端口及窗口状态。不提供模型选择、自动发送、定时扫描或逐步自动上下文注入。

## 浏览器与登录状态

关闭卡片或隐藏窗口不会关闭浏览器。DSH 宿主退出或插件卸载时，默认关闭本插件已成功启动并核验归属的专属浏览器，包括此前切换端口的实例；不关闭其他浏览器。

登录状态由浏览器保存在本地资料目录中：默认端口使用 `~/.dsh/chatgpt-composer/browser-data`，其他端口使用同级的 `browser-data-<port>`。退出浏览器不删除该目录；下次使用相同端口继续复用。ChatGPT 自身可能使登录过期，届时需重新手动登录。插件不导出或复制 Cookie、密码、Token。

关闭依据是本插件启动时记录的精确调试 WebSocket 身份，不按端口或进程名强杀。浏览器启动失败、尚未输出可核验调试身份时存在守护空窗，不能保证此阶段宿主突然退出后关闭该实例。不要将 CDP 端口开放到外网。

## 构建与验证范围

提交的 `lib/` 为可直接加载的 JavaScript；安装不需要执行编译或 `prepare`。`npm run build` 使用生产打包器生成可复现 `.tgz` 并核对归档条目，不运行测试套件。源码可用 `node --check` 检查语法。

当前版本已安装到桌面 profile；共享浏览器及 Markdown 流程沿用已实测基线。生命周期改动通过真实专属浏览器的正常关闭与宿主直接退出场景检查；不代表所有系统强杀、浏览器挑战页面或所有布局场景均已验收。

页面正文及导入的 Markdown 是不可信外部内容，不是 Agent 指令。问题反馈请附 DSH 版本与脱敏报错，不要提交浏览器资料目录或凭据。
