window.__ModuleLoader__.load({
	id: "dsh-chatgpt-composer",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let zod = require("zod");

		/** Package owning the Remote contribution this bundle mounts. */
		const PKG = "dsh-chatgpt-composer";

		//#region styles
		/**
		 * The ambient panel material every composer seat uses, so the pill and its
		 * popover inherit the active native theme instead of hard-coding colors.
		 */
		const CSS = [
			".dsh-cc-pill{border-radius:var(--dsw-radius-sm);min-height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;align-items:center;gap:5px;padding:3px 6px;font-size:12px;line-height:18px;display:inline-flex}",
			".dsh-cc-pill:hover,.dsh-cc-pill:focus-visible{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}",
			".dsh-cc-pill[data-bound=\"true\"]{color:var(--dsw-alias-label-secondary)}",
			".dsh-cc-pill[data-armed=\"true\"]{color:var(--dsw-alias-brand-primary)}",
			".dsh-cc-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-quaternary);flex:none}",
			".dsh-cc-dot[data-armed=\"true\"]{background:var(--dsw-alias-state-success-primary)}",
			".dsh-cc-dot[data-stale=\"true\"]{background:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-quaternary))}",
			".dsh-cc-backdrop{position:fixed;inset:0;z-index:90}",
			".dsh-cc-panel{position:fixed;z-index:91;box-sizing:border-box;width:min(352px,100vw - 24px);max-height:min(72vh,600px);display:flex;flex-direction:column;gap:0;overflow:hidden;border-radius:var(--dsw-radius-lg);background:var(--dsw-menu-surface-fill,var(--dsw-alias-bg-layer-2));box-shadow:var(--dsw-elevation-prominent);border:.5px solid var(--dsw-elevation-stroke-color,var(--dsw-alias-border-l1))}",
			".dsh-cc-head{padding:10px 12px 8px;display:flex;align-items:center;gap:8px;border-bottom:.5px solid var(--dsw-alias-border-l1)}",
			".dsh-cc-title{font-size:13px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-primary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dsh-cc-chip{font-size:11px;line-height:16px;padding:1px 6px;border-radius:var(--dsw-radius-xs);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-fill-l1);flex:none}",
			".dsh-cc-chip[data-tone=\"success\"]{color:var(--dsw-alias-state-success-primary)}",
			".dsh-cc-chip[data-tone=\"warning\"]{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-primary))}",
			".dsh-cc-chip[data-tone=\"error\"]{color:var(--dsw-alias-state-danger-primary,var(--dsw-alias-label-primary))}",
			".dsh-cc-body{padding:10px 12px;display:flex;flex-direction:column;gap:10px;overflow:auto;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}",
			".dsh-cc-row{display:flex;align-items:center;gap:8px;justify-content:space-between}",
			".dsh-cc-label{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}",
			".dsh-cc-value{font-size:12px;line-height:17px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:210px}",
			".dsh-cc-select{font-size:12px;max-width:200px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-fill-l1);border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);padding:2px 4px}",
			".dsh-cc-section{display:flex;flex-direction:column;gap:5px}",
			".dsh-cc-sectionTitle{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}",
			".dsh-cc-list{max-height:168px;overflow:auto;display:flex;flex-direction:column;gap:1px;padding:2px;margin:0;list-style:none;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-fill-l1)}",
			".dsh-cc-option{display:flex;gap:7px;align-items:center;padding:4px 6px;border-radius:var(--dsw-radius-sm);cursor:pointer;font-size:12px;line-height:17px;color:var(--dsw-alias-label-primary)}",
			".dsh-cc-option:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".dsh-cc-optionTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dsh-cc-optionMeta{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:none}",
			".dsh-cc-actions{display:flex;gap:6px;flex-wrap:wrap}",
			".dsh-cc-button{font-size:12px;line-height:18px;padding:3px 9px;border-radius:var(--dsw-radius-sm);cursor:pointer;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-elevated-fill,var(--dsw-alias-fill-l2));border:.5px solid var(--dsw-alias-border-l1)}",
			".dsh-cc-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
			".dsh-cc-button:disabled{opacity:.5;cursor:default}",
			".dsh-cc-button[data-variant=\"primary\"]{color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-brand-text,#fff));background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));border-color:transparent}",
			".dsh-cc-note{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:pre-wrap;word-break:break-word}",
			".dsh-cc-note[data-tone=\"error\"]{color:var(--dsw-alias-state-danger-primary,var(--dsw-alias-label-primary))}",
			".dsh-cc-note[data-tone=\"success\"]{color:var(--dsw-alias-state-success-primary)}",
			".dsh-cc-note[data-tone=\"warning\"]{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-primary))}",
			".dsh-cc-foot{padding:7px 12px 9px;border-top:.5px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:2px}",
		].join("")

		const STYLE_ID = "dsh-chatgpt-composer-style"
		/** Inject the panel stylesheet once for this plugin fiber. */
		function installStyle(doc) {
			if (doc.getElementById(STYLE_ID) !== null) return
			const element = doc.createElement("style")
			element.id = STYLE_ID
			element.textContent = CSS
			doc.head.append(element)
		}
		/** Remove the panel stylesheet this plugin installed. */
		function removeStyle(doc) {
			doc.getElementById(STYLE_ID)?.remove()
		}
		//#endregion

		//#region copy
		const ZH = {
			pill: "ChatGPT",
			title: "ChatGPT 目标",
			close: "关闭",
			boundChip: "已绑定",
			staleChip: "已过期",
			unboundChip: "未绑定",
			account: "账户",
			accountUnknown: "读取不到账户",
			accountUnverified: "仅标签，身份未校验",
			tab: "浏览器标签页",
			tabNone: "没有已打开的 ChatGPT 标签页",
			tabRoot: "新聊天草稿",
			targetTitle: "目标聊天",
			targetNew: "新建聊天草稿（不会发送任何消息）",
			targetChatsEmpty: "该标签页侧栏没有渲染任何已有聊天链接",
			targetApply: "切换到此目标",
			targetVerified: "已读回：URL 中的会话 ID 与两次 target/account 指纹一致",
			targetUnverified: "未通过读回校验",
			modelTitle: "模型（读取模型菜单）",
			modelRead: "读取模型菜单",
			modelSelect: "选择",
			modelUnknown: "尚未读取模型菜单",
			modelHint: "模型仅为显式选择时的已验证记录；只读刷新不能确认当前模型（同强度外部切换不可见）。动作后须完整重新绑定；账户仅标签，非强身份认证。",
			strength: "强度控件（不是模型）",
			composerText: "页面按钮文本",
			selectionVerified: "已读回：重新打开菜单后该选项 aria-checked=true",
			selectionFailed: "未读回为选中，未记录该模型",
			selectionNone: "尚未通过显式选择校验任何模型",
			toggleInjection: "注入上下文快照",
			toggleHint: "关闭开关保留绑定与选择，只停止注入",
			injectionUnavailable: "本部署未注册 pre-step 上下文面（preStepSnapshot=false）",
			injectionStale: "绑定已过期，注入已停止；重新读取并重新绑定可恢复",
			refresh: "读取刷新",
			bind: "绑定并启用",
			unbind: "解除绑定",
			notes: "读回备注",
			busy: "处理中…",
			noTabs: "请在浏览器中打开一个 ChatGPT 标签页（本插件不会为你新建标签页）",
			never: "本插件从不发送 ChatGPT 消息、不读取凭据、不修改 DSH 的 provider 或模型",
		}
		const EN = {
			pill: "ChatGPT",
			title: "ChatGPT target",
			close: "Close",
			boundChip: "bound",
			staleChip: "stale",
			unboundChip: "unbound",
			account: "Account",
			accountUnknown: "account unreadable",
			accountUnverified: "label only, identity unverified",
			tab: "Browser tab",
			tabNone: "No ChatGPT tab is open",
			tabRoot: "new-chat draft",
			targetTitle: "Target chat",
			targetNew: "New-chat draft (sends nothing)",
			targetChatsEmpty: "This tab's sidebar rendered no existing chat link",
			targetApply: "Switch to this target",
			targetVerified: "Read back: the conversation id in the URL and both target/account fingerprints agree",
			targetUnverified: "The read-back did not verify this target",
			modelTitle: "Model (read from the model menu)",
			modelRead: "Read model menu",
			modelSelect: "Select",
			modelUnknown: "The model menu has not been read yet",
			modelHint: "Model identity is historical: verified at explicit selection only. Read-only refresh cannot detect external same-strength model changes. Actions require a complete rebind; account labels are not authentication.",
			strength: "Strength control (not a model)",
			composerText: "Page button text",
			selectionVerified: "Read back: the reopened menu reports this option as aria-checked=true",
			selectionFailed: "Not read back as checked; no model was recorded",
			selectionNone: "No model has been verified by an explicit selection yet",
			toggleInjection: "Inject context snapshot",
			toggleHint: "Turning this off keeps the binding and the selection and only stops injection",
			injectionUnavailable: "This deployment did not register the pre-step context surface (preStepSnapshot=false)",
			injectionStale: "The binding is stale, so injection is stopped; read and bind again to recover",
			refresh: "Refresh",
			bind: "Bind and enable",
			unbind: "Unbind",
			notes: "Read-back notes",
			busy: "working…",
			noTabs: "Open a ChatGPT tab in your browser (this plugin never opens one for you)",
			never: "This plugin never sends a ChatGPT message, never reads credentials, and never changes the DSH provider or model",
		}
		/** Pick the copy table from the page locale. */
		function copyFor(locale) {
			return typeof locale === "string" && locale.toLowerCase().startsWith("zh") ? ZH : EN
		}
		//#endregion

		//#region remote contribution
		/**
		 * Build this bundle's descriptor set.
		 *
		 * The Web module loader resolves a package root and `<id>/client`, never
		 * an arbitrary subpath, so the bundle cannot import the package's generated
		 * `./remote` artifact and inlines the same wire instead. The shapes here
		 * mirror lib/contract.js exactly; scripts/check.mjs compares the two
		 * endpoint-by-endpoint, codec-by-codec, and fails on any drift.
		 */
		function buildContribution() {
			const jsonSchemaOf = (create, io) => typeof zod.toJSONSchema === "function"
				? zod.toJSONSchema(create(), { io, unrepresentable: "any" })
				: undefined
			const requestParameter = (endpoint, fields, strict) => {
				const create = () => zod.object(fields)
				const createStrict = () => zod.strictObject(strict)
				const typeSymbol = `${PKG}#chatgptComposer/${endpoint}:request`
				return {
					name: "request",
					wire: "request",
					source: "json",
					codec: { mode: "strict", typeSymbol, create, jsonSchema: jsonSchemaOf(create, "input") },
					strictCodec: { mode: "strict", typeSymbol, create: createStrict, jsonSchema: jsonSchemaOf(createStrict, "input") },
				}
			}
			const resultCodec = (endpoint, create) => ({
				mode: "strict",
				typeSymbol: `${PKG}#chatgptComposer/${endpoint}:result`,
				create,
				jsonSchema: jsonSchemaOf(create, "output"),
			})

			const account = () => zod.object({ label: zod.string().nullable(), initial: zod.string().nullable() }).nullable()
			const strength = () => zod.object({
				controlLabel: zod.string().nullable(),
				value: zod.string().nullable(),
				sliderValue: zod.number().nullable(),
				min: zod.number().nullable(),
				max: zod.number().nullable(),
			}).nullable()
			const modelButton = () => zod.object({ controlLabel: zod.string(), composerText: zod.string(), strength: strength() }).nullable()
			const tab = () => zod.object({ id: zod.string(), url: zod.string(), title: zod.string(), chatId: zod.string().nullable() })
			const chat = () => zod.object({ id: zod.string(), title: zod.string() })
			const modelOption = () => zod.object({ index: zod.number(), text: zod.string(), checked: zod.boolean() })
			const menuItem = () => zod.object({
				index: zod.number(),
				label: zod.string(),
				text: zod.string(),
				kind: zod.enum(["strength", "item"]),
				sliderValue: zod.number().nullable(),
				min: zod.number().nullable(),
				max: zod.number().nullable(),
			})
			const menu = () => zod.object({ open: zod.boolean(), models: zod.array(modelOption()), items: zod.array(menuItem()) })
			const fingerprint = () => zod.object({
				targetId: zod.string(),
				url: zod.string(),
				chatId: zod.string().nullable(),
				accountLabel: zod.string().nullable(),
				accountInitial: zod.string().nullable(),
			})
			const binding = () => zod.object({
				sessionId: zod.string(),
				active: zod.boolean(),
				target: zod.object({
					kind: zod.enum(["existing", "new"]),
					targetId: zod.string(),
					chatId: zod.string().nullable(),
					title: zod.string().nullable(),
					url: zod.string(),
				}),
				model: zod.object({
					selectedAt: zod.string(),
					name: zod.string(),
					controlLabel: zod.string(),
					composerText: zod.string(),
					strength: zod.string().nullable(),
				}),
				account: account(),
				createdAt: zod.string(),
				updatedAt: zod.string().nullable(),
				verifiedAt: zod.string(),
				liveCheckedAt: zod.string().nullable(),
				verification: zod.object({
					target: zod.enum(["ok", "unverified"]),
					model: zod.enum(["selection-only", "unverified"]),
					account: zod.enum(["unverified"]),
					targetKind: zod.enum(["existing", "new"]),
					chatId: zod.string().nullable(),
					modelName: zod.string().nullable(),
					checkedModel: zod.boolean().nullable(),
					fingerprints: zod.object({ before: fingerprint(), after: fingerprint() }).nullable(),
					notes: zod.array(zod.string()),
				}),
				stale: zod.boolean(),
				staleReason: zod.string().nullable(),
				staleAt: zod.string().nullable(),
				cdpUrl: zod.string(),
			})

			const targetId = () => zod.string()
			const sessionId = () => zod.string()
			const definitions = {
				probe: {
					params: null,
					result: () => zod.object({
						generation: zod.number(),
						cdpUrl: zod.string(),
						reachable: zod.boolean(),
						browser: zod.string().nullable(),
						protocolVersion: zod.string().nullable(),
						chatgptTabs: zod.array(tab()),
						error: zod.string().nullable(),
						generatedAt: zod.string(),
					}),
				},
				readState: {
					params: { fields: { targetId: targetId().optional() }, strict: { targetId: targetId().optional() } },
					result: () => zod.object({
						generation: zod.number(),
						cdpUrl: zod.string(),
						targetId: zod.string().nullable(),
						url: zod.string(),
						title: zod.string(),
						chatId: zod.string().nullable(),
						chats: zod.array(chat()),
						modelButton: modelButton(),
						menu: menu(),
						account: account(),
						composer: zod.object({ found: zod.boolean(), empty: zod.boolean() }),
						notes: zod.array(zod.string()),
						labelPatterns: zod.object({ model: zod.string(), account: zod.string() }),
						generatedAt: zod.string(),
					}),
				},
				readModelMenu: {
					params: { fields: { sessionId: sessionId(), targetId: targetId() }, strict: { sessionId: sessionId(), targetId: targetId() } },
					result: () => zod.object({
						sessionId: zod.string(),
						targetId: zod.string(),
						url: zod.string(),
						opened: zod.boolean(),
						closed: zod.boolean(),
						modelControlLabel: zod.string().nullable(),
						composerText: zod.string(),
						strength: strength(),
						models: zod.array(modelOption()),
						checkedModel: modelOption().nullable(),
						items: zod.array(menuItem()),
						notes: zod.array(zod.string()),
						readAt: zod.string(),
					}),
				},
				selectModel: {
					params: {
						fields: { sessionId: sessionId(), targetId: targetId(), modelIndex: zod.number().optional(), modelName: zod.string().optional() },
						strict: { sessionId: sessionId(), targetId: targetId(), modelIndex: zod.number().optional(), modelName: zod.string().optional() },
					},
					result: () => zod.object({
						sessionId: zod.string(),
						targetId: zod.string(),
						selected: zod.boolean(),
						requested: zod.object({ index: zod.number().nullable(), name: zod.string().nullable() }),
						checkedModel: modelOption().nullable(),
						readBack: zod.boolean(),
						modelControlLabel: zod.string().nullable(),
						strength: strength(),
						composerTextBefore: zod.string(),
						composerTextAfter: zod.string(),
						notes: zod.array(zod.string()),
						readAt: zod.string(),
					}),
				},
				selectChat: {
					params: { fields: { sessionId: sessionId(), targetId: targetId(), chatId: zod.string() }, strict: { sessionId: sessionId(), targetId: targetId(), chatId: zod.string() } },
					result: () => zod.object({
						sessionId: zod.string(),
						targetId: zod.string(),
						chatId: zod.string(),
						verified: zod.boolean(),
						title: zod.string(),
						url: zod.string(),
						fingerprints: zod.object({ before: fingerprint(), after: fingerprint() }),
						notes: zod.array(zod.string()),
						readAt: zod.string(),
					}),
				},
				newChat: {
					params: { fields: { sessionId: sessionId(), targetId: targetId() }, strict: { sessionId: sessionId(), targetId: targetId() } },
					result: () => zod.object({
						sessionId: zod.string(),
						targetId: zod.string(),
						verified: zod.boolean(),
						url: zod.string(),
						chatId: zod.string().nullable(),
						composerFound: zod.boolean(),
						draftEmpty: zod.boolean(),
						fingerprints: zod.object({ before: fingerprint(), after: fingerprint() }),
						notes: zod.array(zod.string()),
						readAt: zod.string(),
					}),
				},
				bind: {
					params: {
						fields: { sessionId: sessionId(), targetId: targetId(), targetKind: zod.enum(["existing", "new"]), chatId: zod.string().optional(), modelName: zod.string() },
						strict: { sessionId: sessionId(), targetId: targetId(), targetKind: zod.enum(["existing", "new"]), chatId: zod.string().optional(), modelName: zod.string() },
					},
					result: () => binding(),
				},
				setActive: {
					params: { fields: { sessionId: sessionId(), active: zod.boolean() }, strict: { sessionId: sessionId(), active: zod.boolean() } },
					result: () => binding(),
				},
				unbind: {
					params: { fields: { sessionId: sessionId() }, strict: { sessionId: sessionId() } },
					result: () => zod.object({ sessionId: zod.string(), removed: zod.boolean() }),
				},
				status: {
					params: { fields: { sessionId: sessionId(), refresh: zod.boolean().optional() }, strict: { sessionId: sessionId(), refresh: zod.boolean().optional() } },
					result: () => zod.object({
						sessionId: zod.string(),
						bound: zod.boolean(),
						binding: binding().nullable(),
						snapshot: zod.string().nullable(),
						injectionArmed: zod.boolean(),
						injectionAvailable: zod.boolean(),
						toolName: zod.string(),
						preStep: zod.object({ enabled: zod.boolean(), appended: zod.number(), failed: zod.string().nullable() }),
						cdpUrl: zod.string(),
						lastReadGeneration: zod.number(),
						generatedAt: zod.string(),
					}),
				},
			}
			return {
				package: PKG,
				descriptors: Object.entries(definitions).map(([method, definition]) => ({
					id: `${PKG}#chatgptComposer/${method}`,
					service: "chatgptComposer",
					namespace: "chatgptComposer",
					method,
					invocation: { kind: "direct" },
					parameters: definition.params === null ? [] : [requestParameter(method, definition.params.fields, definition.params.strict)],
					result: resultCodec(method, definition.result),
				})),
			}
		}
		//#endregion

		//#region client calls
		/** Diagnostic raised when this bundle's contribution is not mounted. */
		const NO_REMOTE = "Downstream Remote namespace remote.chatgptComposer is not mounted"
		/**
		 * Resolve one mounted Remote namespace method at call time.
		 * @param ctx - Client root context.
		 * @returns the namespace service, or undefined while it is not mounted.
		 */
		function namespaceOf(ctx) {
			try {
				return ctx.get("remote.chatgptComposer")
			} catch (error) {
				return undefined
			}
		}
		/** Build one request object without undefined members, which are not JSON-safe on the wire. */
		function requestOf(fields) {
			const request = {}
			for (const [key, value] of Object.entries(fields)) {
				if (value !== undefined && value !== null) request[key] = value
			}
			return request
		}
		/**
		 * Invoke one endpoint and unwrap the Remote result envelope.
		 * A failed envelope becomes a thrown Error carrying the host's own message,
		 * so a failure can never be rendered as a success.
		 * @param ctx - Client root context.
		 * @param method - endpoint method name.
		 * @param args - positional arguments matching the declared request shape.
		 * @returns the decoded value.
		 */
		async function call(ctx, method, args) {
			const namespace = namespaceOf(ctx)
			if (namespace === undefined) throw new Error(NO_REMOTE)
			const fn = namespace[method]
			if (typeof fn !== "function") throw new Error(`${NO_REMOTE} (missing method ${method})`)
			const result = await fn.apply(namespace, args)
			if (result === null || typeof result !== "object" || typeof result.ok !== "boolean") {
				throw new Error(`chatgpt-composer: malformed Remote result for ${method}`)
			}
			if (result.ok !== true) {
				const failure = result.error
				throw new Error(typeof failure?.message === "string" ? failure.message : `chatgpt-composer: ${method} failed`)
			}
			return result.value
		}
		/** Render one thrown value as a message. */
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error)
		}
		//#endregion

		//#region per-session store
		/** Stores by session id, so a session keeps its picker state across re-renders. */
		const stores = new Map()
		/**
		 * One session's toggle state.
		 *
		 * Every call carries a generation: a response that is no longer the newest
		 * request, or that lands after the session changed, is dropped instead of
		 * being applied to the panel. Nothing about another session is ever read or
		 * written from here.
		 */
		class SessionStore {
			constructor(ctx, sessionId) {
				this.ctx = ctx
				this.sessionId = sessionId
				this.listeners = new Set()
				this.generation = 0
				this.state = {
					phase: "idle",
					busy: false,
					error: null,
					status: null,
					probe: null,
					remote: null,
					menu: null,
					selection: null,
					targetReport: null,
					notes: [],
					draft: { targetId: undefined, targetKind: "new", chatId: undefined },
				}
			}
			getState() {
				return this.state
			}
			subscribe(listener) {
				this.listeners.add(listener)
				return () => {
					this.listeners.delete(listener)
				}
			}
			/** Replace state and notify subscribers. */
			set(patch) {
				this.state = { ...this.state, ...patch }
				for (const listener of [...this.listeners]) listener()
			}
			/** Move the draft target selection. */
			patchDraft(patch) {
				this.set({ draft: { ...this.state.draft, ...patch } })
			}
			/** Begin a new generation; any older in-flight response becomes stale. */
			next() {
				this.generation += 1
				return this.generation
			}
			/** Whether one generation is still the newest. */
			fresh(generation) {
				return generation === this.generation
			}
			/** Refresh binding status, the browser probe and the chosen tab's rendered facts. */
			async refresh() {
				const generation = this.next()
				this.set({ busy: true, error: null })
				let status
				try {
					status = await call(this.ctx, "status", [requestOf({ sessionId: this.sessionId, refresh: true })])
					if (!this.fresh(generation)) return
					this.set({ status, phase: status.bound === true ? "bound" : "unbound" })
				} catch (error) {
					if (!this.fresh(generation)) return
					this.set({ busy: false, error: messageOf(error), phase: "error" })
					return
				}
				const boundTab = status.binding?.target?.targetId
				const draft = { ...this.state.draft }
				if (draft.targetId === undefined && typeof boundTab === "string") draft.targetId = boundTab
				try {
					const probe = await call(this.ctx, "probe", [])
					if (!this.fresh(generation)) return
					const tabs = probe.chatgptTabs ?? []
					this.set({ probe })
					if (probe.reachable !== true) {
						this.set({ busy: false, error: probe.error ?? copyFor(undefined).noTabs })
						return
					}
					if (draft.targetId === undefined && tabs.length > 0) draft.targetId = tabs[0].id
					// Keep a disappeared target selected; never silently fall back to another tab.
					this.set({ draft })
					if (tabs.length === 0) {
						this.set({ remote: null, busy: false, notes: [] })
						return
					}
				} catch (error) {
					if (!this.fresh(generation)) return
					this.set({ busy: false, error: messageOf(error) })
					return
				}
				await this.readTab(generation)
			}
			/** Read the chosen tab's rendered facts without touching it. */
			async readTab(generation) {
				const tabId = this.state.draft.targetId
				if (tabId === undefined) {
					this.set({ remote: null, busy: false })
					return
				}
				try {
					const remote = await call(this.ctx, "readState", [requestOf({ targetId: tabId })])
					if (!this.fresh(generation)) return
					const draft = { ...this.state.draft }
					draft.targetId = remote.targetId ?? tabId
					if (draft.targetKind === "existing" && (remote.chats ?? []).some((row) => row.id === draft.chatId) !== true) {
						draft.chatId = undefined
					}
					this.set({ remote, draft, busy: false, notes: remote.notes ?? [] })
				} catch (error) {
					if (!this.fresh(generation)) return
					this.set({ remote: null, busy: false, error: messageOf(error) })
					await this.refreshStatus(generation)
				}
			}
			/** Choose the tab every later action targets. */
			async selectTab(targetId) {
				const generation = this.next()
				const draft = { ...this.state.draft, targetId, targetKind: "new", chatId: undefined }
				this.set({ draft, menu: null, selection: null, targetReport: null, busy: true, error: null })
				await this.readTab(generation)
			}
			/** Explicitly open, read and close the model menu. */
			async readMenu() {
				const generation = this.next()
				const tabId = this.state.draft.targetId
				if (tabId === undefined) return
				this.set({ busy: true, error: null, selection: null })
				try {
					const menu = await call(this.ctx, "readModelMenu", [requestOf({ sessionId: this.sessionId, targetId: tabId })])
					if (!this.fresh(generation)) return
					this.set({ menu, selection: null, notes: menu.notes ?? [], busy: false })
					await this.refreshStatus(generation)
				} catch (error) {
					if (!this.fresh(generation)) return
					this.set({ busy: false, error: messageOf(error) })
					await this.refreshStatus(generation)
				}
			}
			/** Explicitly select one model option and keep only a checked read-back. */
			async selectModel(model) {
				const generation = this.next()
				const tabId = this.state.draft.targetId
				if (tabId === undefined) return
				this.set({ busy: true, error: null, selection: null })
				try {
					const selection = await call(this.ctx, "selectModel", [requestOf({ sessionId: this.sessionId, targetId: tabId, modelIndex: model.index, modelName: model.text })])
					if (!this.fresh(generation)) return
					this.set({ selection, notes: selection.notes ?? [], busy: false })
					await this.refreshStatus(generation)
				} catch (error) {
					if (!this.fresh(generation)) return
					this.set({ busy: false, error: messageOf(error) })
					await this.refreshStatus(generation)
				}
			}
			/** Explicitly switch the chosen tab to one existing chat. */
			async selectChat(chatId) {
				const generation = this.next()
				const tabId = this.state.draft.targetId
				if (tabId === undefined) return
				this.set({ busy: true, error: null, targetReport: null, selection: null, menu: null })
				try {
					const targetReport = await call(this.ctx, "selectChat", [requestOf({ sessionId: this.sessionId, targetId: tabId, chatId })])
					if (!this.fresh(generation)) return
					this.set({ targetReport, notes: targetReport.notes ?? [], busy: false })
					await this.refreshStatus(generation)
				} catch (error) {
					if (!this.fresh(generation)) return
					this.set({ busy: false, error: messageOf(error) })
					await this.refreshStatus(generation)
				}
			}
			/** Explicitly switch the chosen tab to a new-chat draft. */
			async newChat() {
				const generation = this.next()
				const tabId = this.state.draft.targetId
				if (tabId === undefined) return
				this.set({ busy: true, error: null, targetReport: null, selection: null, menu: null })
				try {
					const targetReport = await call(this.ctx, "newChat", [requestOf({ sessionId: this.sessionId, targetId: tabId })])
					if (!this.fresh(generation)) return
					this.set({ targetReport, notes: targetReport.notes ?? [], busy: false })
					await this.refreshStatus(generation)
				} catch (error) {
					if (!this.fresh(generation)) return
					this.set({ busy: false, error: messageOf(error) })
					await this.refreshStatus(generation)
				}
			}
			/** Commit the verified tab, target and model as this session's binding. */
			async bind() {
				const generation = this.next()
				const { draft, selection } = this.state
				if (draft.targetId === undefined) return
				if (selection === null || selection.readBack !== true) {
					this.set({ error: copyFor(globalThis.navigator?.language).selectionNone })
					return
				}
				this.set({ busy: true, error: null })
				try {
					await call(this.ctx, "bind", [requestOf({
						sessionId: this.sessionId,
						targetId: draft.targetId,
						targetKind: draft.targetKind,
						chatId: draft.targetKind === "existing" ? draft.chatId : undefined,
						modelName: selection.checkedModel?.text,
					})])
					if (!this.fresh(generation)) return
				} catch (error) {
					if (!this.fresh(generation)) return
					this.set({ busy: false, error: messageOf(error), phase: "error" })
					await this.refreshStatus(generation)
					return
				}
				await this.refreshStatus(generation)
			}
			/** Arm or disarm injection without dropping the binding. */
			async setActive(active) {
				const generation = this.next()
				this.set({ busy: true, error: null })
				try {
					await call(this.ctx, "setActive", [requestOf({ sessionId: this.sessionId, active })])
					if (!this.fresh(generation)) return
				} catch (error) {
					if (!this.fresh(generation)) return
					this.set({ busy: false, error: messageOf(error) })
					return
				}
				await this.refreshStatus(generation)
			}
			/** Drop the binding. */
			async unbind() {
				const generation = this.next()
				this.set({ busy: true, error: null })
				try {
					await call(this.ctx, "unbind", [requestOf({ sessionId: this.sessionId })])
					if (!this.fresh(generation)) return
				} catch (error) {
					if (!this.fresh(generation)) return
					this.set({ busy: false, error: messageOf(error) })
					return
				}
				await this.refreshStatus(generation)
			}
			/** Re-read only the binding status inside an existing generation. */
			async refreshStatus(generation) {
				try {
					const status = await call(this.ctx, "status", [requestOf({ sessionId: this.sessionId })])
					if (!this.fresh(generation)) return
					this.set({ status, phase: status.bound === true ? "bound" : "unbound", busy: false })
				} catch (error) {
					if (!this.fresh(generation)) return
					this.set({ busy: false, error: messageOf(error) })
				}
			}
		}
		/** Read one store per session, creating it on first use. */
		function storeFor(ctx, sessionId) {
			const key = String(sessionId)
			let store = stores.get(key)
			if (store === undefined) {
				store = new SessionStore(ctx, key)
				stores.set(key, store)
			}
			return store
		}
		//#endregion

		//#region component
		const h = react.createElement
		/**
		 * The composer-right pill plus its popover.
		 * @param props - the slot's injected session id, store and copy table.
		 * @returns the pill, or null without a session.
		 */
		function ChatGptComposerAction(props) {
			const { sessionId, store, copy } = props
			const [open, setOpen] = react.useState(false)
			const [state, setState] = react.useState(store === undefined ? null : store.getState())
			const [anchor, setAnchor] = react.useState(null)
			const pillRef = react.useRef(null)
			const panelRef = react.useRef(null)
			react.useEffect(() => {
				if (store === undefined) return undefined
				return store.subscribe(() => setState(store.getState()))
			}, [store])
			react.useEffect(() => {
				if (!open || panelRef.current === null) return
				panelRef.current.focus()
			}, [open])
			if (sessionId === undefined || store === undefined || state === null) return null
			const status = state.status
			const bound = status?.bound === true
			const stale = status?.binding?.stale === true
			const armed = status?.injectionArmed === true && state.error === null && state.busy !== true
			/** Position the popover above the composer pill, clamped into the viewport. */
			const toggle = () => {
				if (open) {
					setOpen(false)
					pillRef.current?.focus()
					return
				}
				const rect = pillRef.current?.getBoundingClientRect()
				if (rect !== undefined) {
					const width = Math.min(352, window.innerWidth - 24)
					const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))
					setAnchor({ left, bottom: Math.max(12, window.innerHeight - rect.top + 8) })
				}
				setOpen(true)
				void store.refresh()
			}
			/** Close and hand focus back to the pill, which is where the keyboard user was. */
			const close = () => {
				setOpen(false)
				pillRef.current?.focus()
			}
			const onKeyDown = (event) => {
				if (event.key === "Escape") {
					event.stopPropagation()
					close()
				}
			}

			const chipTone = state.error !== null ? "error" : stale ? "warning" : bound ? "success" : undefined
			const chipText = stale ? copy.staleChip : bound ? copy.boundChip : copy.unboundChip

			const pill = h("button", {
				type: "button",
				ref: pillRef,
				className: "dsh-cc-pill",
				"data-bound": String(bound),
				"data-armed": String(armed),
				"aria-expanded": open,
				"aria-haspopup": "dialog",
				"aria-label": `${copy.title} - ${armed ? copy.boundChip : bound ? copy.toggleHint : copy.unboundChip}`,
				onClick: toggle,
				onKeyDown,
			}, h("span", { className: "dsh-cc-dot", "data-armed": String(armed), "data-stale": String(stale) }), copy.pill)

			if (!open) return pill

			const tabs = state.probe?.chatgptTabs ?? []
			const draft = state.draft
			const chats = state.remote?.chats ?? []
			const menuResult = state.menu
			const selection = state.selection
			const observedModel = state.remote?.modelButton ?? null
			const notes = state.notes ?? []
			const busy = state.busy === true

			const tabSection = h("div", { className: "dsh-cc-section", key: "tabs" }, [
				h("div", { className: "dsh-cc-sectionTitle", key: "t" }, copy.tab),
				tabs.length === 0
					? h("div", { className: "dsh-cc-note", key: "none" }, copy.tabNone)
					: h("select", {
						key: "s",
						className: "dsh-cc-select",
						value: draft.targetId ?? "",
						disabled: busy,
						"aria-label": copy.tab,
						onChange: (event) => void store.selectTab(event.target.value),
					}, tabs.map((tab) => h("option", { key: tab.id, value: tab.id },
						`${tab.chatId === null ? copy.tabRoot : tab.chatId.slice(0, 8)} · ${tab.title || tab.url} · ${tab.id.slice(0, 8)}`))),
			])

			const targetSection = h("div", { className: "dsh-cc-section" }, [
				h("div", { className: "dsh-cc-sectionTitle", key: "t" }, copy.targetTitle),
				h("ul", { className: "dsh-cc-list", key: "l" }, [
					h("li", { key: "__new" }, h("label", { className: "dsh-cc-option" }, [
						h("input", {
							key: "r",
							type: "radio",
							name: "dsh-cc-target",
							checked: draft.targetKind === "new",
							disabled: busy,
							onChange: () => store.patchDraft({ targetKind: "new", chatId: undefined }),
						}),
						h("span", { className: "dsh-cc-optionTitle", key: "n" }, copy.targetNew),
					])),
					...chats.map((chat) => h("li", { key: chat.id }, h("label", { className: "dsh-cc-option", title: chat.id }, [
						h("input", {
							key: "r",
							type: "radio",
							name: "dsh-cc-target",
							checked: draft.targetKind === "existing" && draft.chatId === chat.id,
							disabled: busy,
							onChange: () => store.patchDraft({ targetKind: "existing", chatId: chat.id }),
						}),
						h("span", { className: "dsh-cc-optionTitle", key: "n" }, chat.title),
						h("span", { className: "dsh-cc-optionMeta", key: "m" }, chat.id.slice(0, 8)),
					]))),
				]),
				chats.length === 0 ? h("div", { className: "dsh-cc-note", key: "e" }, copy.targetChatsEmpty) : null,
				h("div", { className: "dsh-cc-actions", key: "a" }, [
					h("button", {
						key: "apply",
						type: "button",
						className: "dsh-cc-button",
						disabled: busy || draft.targetId === undefined || (draft.targetKind === "existing" && draft.chatId === undefined),
						onClick: () => void (draft.targetKind === "existing" ? store.selectChat(draft.chatId) : store.newChat()),
					}, copy.targetApply),
				]),
				state.targetReport === null ? null : h("div", {
					key: "r",
					className: "dsh-cc-note",
					"data-tone": state.targetReport.verified === true ? "success" : "warning",
				}, `${state.targetReport.verified === true ? copy.targetVerified : copy.targetUnverified}\n${state.targetReport.notes.join("\n")}`),
			])

			const modelSection = h("div", { className: "dsh-cc-section" }, [
				h("div", { className: "dsh-cc-sectionTitle", key: "t" }, copy.modelTitle),
				h("div", { className: "dsh-cc-row", key: "composer" }, [
					h("span", { className: "dsh-cc-label", key: "l" }, copy.composerText),
					h("span", { className: "dsh-cc-value", key: "v", title: observedModel?.controlLabel ?? "" },
						observedModel === null ? copy.modelUnknown : observedModel.composerText),
				]),
				menuResult === null
					? h("div", { className: "dsh-cc-note", key: "none" }, copy.modelUnknown)
					: h("ul", { className: "dsh-cc-list", key: "l" }, [
						...menuResult.models.map((model) => h("li", { key: model.index }, h("div", { className: "dsh-cc-option" }, [
							h("input", {
								key: "r",
								type: "radio",
								name: "dsh-cc-model",
								readOnly: true,
								checked: selection?.readBack === true ? selection.checkedModel?.index === model.index : model.checked,
							}),
							h("span", { className: "dsh-cc-optionTitle", key: "n" }, model.text),
							h("button", {
								key: "b",
								type: "button",
								className: "dsh-cc-button",
								disabled: busy,
								onClick: () => void store.selectModel(model),
							}, copy.modelSelect),
						]))),
						...menuResult.items.map((item) => h("li", { key: `i${String(item.index)}` }, h("div", { className: "dsh-cc-option" }, [
							h("span", { className: "dsh-cc-optionTitle", key: "n" }, `${item.label || item.text || "(unlabelled)"}${item.sliderValue === null ? "" : ` = ${String(item.sliderValue)}`}`),
							h("span", { className: "dsh-cc-optionMeta", key: "m" }, item.kind === "strength" ? copy.strength : ""),
						]))),
					]),
				menuResult !== null && menuResult.items.some((item) => item.kind === "strength")
					? h("div", { className: "dsh-cc-note", key: "strength", "data-tone": "warning" }, copy.strength)
					: null,
				h("div", { className: "dsh-cc-note", key: "h" }, copy.modelHint),
				selection === null
					? h("div", { className: "dsh-cc-note", key: "sel" }, copy.selectionNone)
					: h("div", { className: "dsh-cc-note", key: "sel", "data-tone": selection.readBack === true ? "success" : "warning" },
						`${selection.readBack === true ? copy.selectionVerified : copy.selectionFailed} · ${selection.readAt}\n${selection.notes.join("\n")}`),
				h("div", { className: "dsh-cc-actions", key: "a" }, [
					h("button", {
						key: "read",
						type: "button",
						className: "dsh-cc-button",
						disabled: busy || draft.targetId === undefined,
						onClick: () => void store.readMenu(),
					}, copy.modelRead),
				]),
			])

			const injectionEnabled = status?.injectionAvailable === true && !status?.preStep?.failed
			const injectionRow = h("div", { className: "dsh-cc-section", key: "inject" }, [
				h("div", { className: "dsh-cc-row", key: "r" }, [
					h("span", { className: "dsh-cc-label", key: "l", title: copy.toggleHint }, copy.toggleInjection),
					h("input", {
						key: "c",
						type: "checkbox",
						checked: armed,
						disabled: !bound || stale || !injectionEnabled || busy,
						onChange: (event) => void store.setActive(event.target.checked),
					}),
				]),
				injectionEnabled ? null : h("div", { className: "dsh-cc-note", key: "off", "data-tone": "warning" }, status?.preStep?.failed ?? copy.injectionUnavailable),
				stale ? h("div", { className: "dsh-cc-note", key: "stale", "data-tone": "warning" }, copy.injectionStale) : null,
			])

			const accountRow = h("div", { className: "dsh-cc-row", key: "account" }, [
				h("span", { className: "dsh-cc-label", key: "l" }, copy.account),
				h("span", { className: "dsh-cc-value", key: "v", title: state.remote?.account?.label ?? "" },
					state.remote?.account === null || state.remote?.account === undefined
						? copy.accountUnknown
						: `${state.remote.account.label ?? state.remote.account.initial ?? ""} (${copy.accountUnverified})`),
			])

			const actions = h("div", { className: "dsh-cc-actions", key: "a" }, [
				h("button", {
					key: "refresh",
					type: "button",
					className: "dsh-cc-button",
					disabled: busy,
					onClick: () => void store.refresh(),
				}, copy.refresh),
				h("button", {
					key: "bind",
					type: "button",
					className: "dsh-cc-button",
					"data-variant": "primary",
					disabled: busy || draft.targetId === undefined || selection === null || selection.readBack !== true,
					onClick: () => void store.bind(),
				}, copy.bind),
				bound ? h("button", {
					key: "unbind",
					type: "button",
					className: "dsh-cc-button",
					disabled: busy,
					onClick: () => void store.unbind(),
				}, copy.unbind) : null,
			])

			const boundLine = bound
				? h("div", { className: "dsh-cc-note", key: "b", "data-tone": stale ? "warning" : undefined },
					`${status.binding.target.kind === "existing" ? status.binding.target.title ?? status.binding.target.chatId : copy.targetNew} · ${status.binding.model.name} · ${status.binding.verifiedAt}${stale ? `\n${status.binding.staleReason ?? ""}` : ""}`)
				: null

			const errorLine = state.error === null
				? null
				: h("div", { className: "dsh-cc-note", key: "err", "data-tone": "error" }, state.error)

			const notesBlock = notes.length === 0 ? null : h("div", { className: "dsh-cc-section", key: "notes" }, [
				h("div", { className: "dsh-cc-sectionTitle", key: "t" }, copy.notes),
				h("div", { className: "dsh-cc-note", key: "n" }, notes.join("\n")),
			])

			const panel = h("div", {
				ref: panelRef,
				className: "dsh-cc-panel",
				role: "dialog",
				"aria-label": copy.title,
				tabIndex: -1,
				onKeyDown,
				style: anchor === null ? undefined : { left: `${String(anchor.left)}px`, bottom: `${String(anchor.bottom)}px` },
			}, [
				h("div", { className: "dsh-cc-head", key: "head" }, [
					h("span", { className: "dsh-cc-title", key: "t" }, copy.title),
					state.busy ? h("span", { className: "dsh-cc-chip", key: "busy" }, copy.busy) : null,
					h("span", { className: "dsh-cc-chip", key: "chip", "data-tone": chipTone }, chipText),
					h("button", {
						key: "close",
						type: "button",
						className: "dsh-cc-pill",
						"aria-label": copy.close,
						onClick: close,
					}, "✕"),
				]),
				h("div", { className: "dsh-cc-body", key: "body" }, [
					accountRow,
					tabSection,
					targetSection,
					modelSection,
					injectionRow,
					boundLine,
					actions,
					errorLine,
					notesBlock,
				]),
				h("div", { className: "dsh-cc-foot", key: "foot" }, [
					h("div", { className: "dsh-cc-note", key: "cdp" }, `${status?.cdpUrl ?? ""}${status?.toolName === undefined ? "" : ` · ${status.toolName}`}`),
					h("div", { className: "dsh-cc-note", key: "never" }, copy.never),
				]),
			])

			return h(react.Fragment, null, [
				h("div", { key: "backdrop", className: "dsh-cc-backdrop", onPointerDown: close }),
				pill,
				panel,
			])
		}
		//#endregion

		//#region registration
		/** Required Client services: the slot registry and the Gateway Remote facade. */
		const inject = ["slots", "remote"]

		/**
		 * Register the composer-right slot and mount this bundle's Remote contribution.
		 * @param ctx - Client root context.
		 */
		function apply(ctx) {
			const doc = globalThis.document
			if (doc !== undefined && doc !== null) {
				installStyle(doc)
				ctx.effect(() => () => {
					removeStyle(doc)
				}, "chatgpt-composer: styles")
			}
			// Mount the descriptor set through the published Gateway entry. A failed
			// mount is reported in the panel through `call()`; it is never faked.
			ctx.effect(() => {
				let dispose
				let disposed = false
				void ctx.remote.$mount(buildContribution()).then(
					(teardown) => {
						if (disposed) void teardown()
						else dispose = teardown
					},
					(error) => {
						console.warn("chatgpt-composer: Remote contribution mount failed", error)
					},
				)
				return () => {
					disposed = true
					if (dispose !== undefined) void dispose()
				}
			}, "chatgpt-composer: Remote contribution")

			ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
				name: "conversation.input.right",
				id: "chatgpt-composer",
				order: 30,
				inject: (sessionId) => sessionId === undefined
					? { sessionId: undefined, store: undefined, copy: copyFor(undefined) }
					: { sessionId, store: storeFor(ctx, sessionId), copy: copyFor(globalThis.navigator?.language) },
			}, ChatGptComposerAction))
		}
		//#endregion

		exports.apply = apply
		exports.inject = inject
		return module.exports
	}
})
