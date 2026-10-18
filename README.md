# dsh-chatgpt-composer 0.1.4

DSH 0.2.1-rc.2 的会话级 ChatGPT composer-right 插件。将当前 DSH 会话引用绑定到用户显式选择的 CDP targetId、聊天（或根路径空草稿）以及一次显式选择时读回的模型。不会发送消息、输入文字、访问凭据或改变 DSH provider/model。

## 安装

显示名称：**ChatGPT 会话绑定**。这是输入框右侧的目标绑定控件，**不是 ChatGPT provider，也不会替你发送消息**。

在 DSH 桌面端侧边栏打开 **插件 → 添加插件 → 安装第三方插件**，输入本仓库地址：

```text
https://github.com/ZhiweiWei-NAMI/dsh-chatgpt-composer.git
```

也支持填写已检出仓库的**绝对本地目录**，或从 [Releases](https://github.com/ZhiweiWei-NAMI/dsh-chatgpt-composer/releases) 下载 `.tgz` 后填写其绝对路径。不手改 desktop profile。若应用提示需要重启，请按提示操作；不能保证所有安装都热生效。

包已提交可直接加载的 JavaScript、浏览器 ModuleLoader bundle、Typert host/remote artifacts 和 `cordis.patch.yml`，安装时不需要执行 `prepare` 或编译。`puppeteer-core` 是包依赖；你必须已有启用本机 CDP 调试端口的 Chromium 浏览器，并在其中登录 ChatGPT。默认端点 `http://127.0.0.1:9222`；不要将调试端口开放到外网。本插件不启动、重启或关闭浏览器。

## 使用与边界

显式选择标签页 → 显式切换聊天/新草稿 → 读取模型菜单并选择模型 → 绑定并启用。之后任何打开模型菜单、切换聊天、新聊天或模型选择动作（无论成功、返回否定还是抛错），都会先将相关绑定标记为 stale，保留旧引用供查看，但停止注入；同一标签页的其他会话绑定也会失效。导航成功不会借用旧模型恢复绑定，模型局部成功也不会重新启用旧聊天。

**只有完整 bind 成功才能创建 fresh 绑定**。需要重新选择模型并完整绑定。普通刷新、只读工具、pre-step recheck 和启用开关都不能清除 stale。旧选择不再是 bind 凭证，UI 保留的历史引用不等于可执行授权。

- `selectModel` 只点击菜单 `role=menuitemradio`，重新打开菜单验证唯一选中项后关闭。同时给 index/name 时按唯一精确 name 定位，点击当刻再次确认唯一且未 disabled；`requested` 保留原请求。`Pro` 等普通 menuitem/强度 slider 不是模型。
- `selectChat` 点击指定聊天的侧栏链接，缺失时导航到对应 `/c/<id>`，读回 URL、target/account 标签指纹。
- `newChat` 对 `/g/custom` 等非根路径也必须导航到 **https://chatgpt.com/**；只有精确根 URL、无 chatId、存在空 composer 才算成功。绝不发送消息来创建会话。
- `bind` 校验显式选择上下文与两次只读页面事实一致，包括精确 targetId、可信 HTTPS origin、路径/chatId、账户标签/首字母和不透明模型控件文本；这些事实不是账户认证或实时模型身份认证。

### 模型观测不是实时身份认证

绑定的模型名是**显式选择时** checked radio 的历史观测，带 `model.selectedAt`；`verification.model=selection-only`。页面按钮可能只写“思考强度Pro”：同强度下外部模型切换无法只读检测。只读工具与 pre-step 只确认当前 URL/target、标签与控件可读性，**不能证明当前模型仍是该模型**。快照明确说明这一点，同时保留有用的历史模型引用。`verifiedAt` 是完整绑定时间，`liveCheckedAt` 仅是目标/控件只读观测时间，绝不刷新模型观测时间。

账户始终 `unverified`。通用资料标签/头像首字母不具备强身份隔离能力；原有账户标签/首字母消失或改变会拒绝，但未知账户不会被伪称已认证。

## 安全状态与 UI

刷新面板会对绑定执行有界只读 recheck；失败保留选择、显示 stale 原因并关停注入。UI 不会在所选 target 消失时悄悄选择另一个标签页。所有失败动作都会刷新 host 状态，旧绑定不会显示成“未绑定”来掩盖 retained-but-stale 状态。

`chatgpt_target` 是无参数只读工具，永不点击菜单或导航。`agent/pre-step` 每步在注入前实时 recheck，**总预算不超过 readTimeoutMs（上限 12 秒，包含排队）**，离线、超时、路径变化、账户标签消失等均不注入。超时后的晚到结果不能清除 stale。快照是明确标注不可信页面数据的 **user-role** 消息，不是 developer 指令；每步至多一条。快照构造异常后禁用该进程的注入并在 status 暴露原因。

CDP 每次操作与读回重新检查当前可信 HTTPS origin，不缓存可变 URL；主世界操作在同一任务内检查 origin；fallback 导航用同步 guard + `location.assign`，正常 context destroyed 仅交由后续精确读回判定，不吞跨站错误。目标按精确 CDP id 解析，不回退其他标签页。不会读 cookie、token、storage，或请求 ChatGPT 内部 JSON API；退出仅 `disconnect()`。

## 配置

| 键 | 默认 | 含义 |
|---|---|---|
| cdpUrl | http://127.0.0.1:9222 | 用户已有浏览器的 loopback 调试端点 |
| connectTimeoutMs | 8000 | 连接与 CDP 身份读取预算 |
| readTimeoutMs | 12000 | 单次页面读取预算及 pre-step 总预算（pre-step 上限 12000） |
| modelLabelPattern | 模型\|model | 模型按钮 accessible label |
| accountLabelPattern | profile\|个人资料\|account\|账户\|设置\|settings | 资料按钮标签 |
| preStepSnapshot | true | 是否注册注入面；仍需用户完整绑定启用 |
| toolName | chatgpt_target | 只读工具名 |

可用 `DSH_CHATGPT_COMPOSER_PUPPETEER` 指向已安装的 puppeteer-core 模块。绑定仅在内存存活，不跨重启持久化。

## 检查与可复现打包

需要 Node.js 24 LTS 与 npm；源码是提交在 `lib/` 中的 JavaScript，不另做 TypeScript 编译。

```sh
git clone https://github.com/ZhiweiWei-NAMI/dsh-chatgpt-composer.git
cd dsh-chatgpt-composer
npm ci --ignore-scripts
npm run build
```

`build` 先运行检查，再产生 `dsh-chatgpt-composer-0.1.4.tgz`。所有检查依赖通过 `package-lock.json` 从公开 npm 安装，不依赖开发机 `.sdk`、desktop profile 或绝对路径。默认检查加载真实发布契约及 host/client codec，并针对安全反例使用 adapter/CDP mocks；不操作用户浏览器、聊天、profile 或 GUI。临时文件只写本仓库 `.check/`。

`npm run pack` 可单独打包。使用固定 tar 元数据、排序条目及 gzip 级别，验证条目集合并打印 SHA-256；在相同 Node 环境连续运行应生成相同字节。

GitHub Actions 在 push/PR 或手动运行时执行构建并上传安装包及 `SHA256SUMS`。推送与 package 版本匹配的 `v0.1.4` 标签会在构建通过后创建 **GitHub 预发布**，不发布到 npm。安装包不包含开发依赖、测试脚本或本地缓存。

Lead 在临时真实 ChatGPT 页测试了模型菜单、重新选择当前模型、已有聊天导航。0.1.3 实机测试暴露导航期间执行上下文销毁；0.1.4 优先点击现有新聊天入口，避免整页重载；缺失入口时才使用受保护的 URL 导航。仅对导航读回增加有界重试，每次仍检查来源并等待账户标签指纹一致。最终源码的完整浏览器场景（菜单、当前模型重选、已有聊天、新草稿）已通过。页面头像初始文字变化时仍可能安全拒绝：等待页面稳定后刷新并重新绑定，不降低身份检查来假报成功。

**尚未完成真实 DSH 安装、RPC、UI 渲染和 agent 回合验收**。不同模型间切换未实测；模型实时身份及账户强身份认证仍无保证。浏览器验收未发送消息，只操作测试创建的临时页，结束关闭临时页并断开连接。

此版本是预发布；上述浏览器验证不代表 DSH 宿主端到端验收已完成。欢迎在 Issues 提供去除个人信息后的报错与 DSH 版本；不要提交 CDP 会话数据、cookie 或凭据。
