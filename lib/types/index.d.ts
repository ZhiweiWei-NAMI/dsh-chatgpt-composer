/**
 * Public typings for dsh-chatgpt-composer's host half (slim read-only edition).
 *
 * Declared surface: connect the dedicated background browser once, read the
 * rendered conversation list, and read a conversation's rendered turns. There is
 * no target binding, no model selection, no chat creation and no injection.
 *
 * These declarations describe this package's own surface. They deliberately do
 * not re-declare DSH's internal types: the Remote methods are reached at run time
 * through the generated `exports["./typert"]` artifact, and a consumer that wants
 * the typed methods imports `dsh-chatgpt-composer/remote`.
 */

/** Deployment configuration. */
export interface ChatGptComposerConfig {
  /** DevTools endpoint of the plugin-owned background browser; loopback http://127.0.0.1:<1024–65535>. */
  cdpUrl?: string
  /** Budget for attaching to that endpoint, in milliseconds. */
  connectTimeoutMs?: number
  /** Budget for one page read, in milliseconds. */
  readTimeoutMs?: number
  /** Matcher for the composer model control's accessible label, used for the model observation only. */
  modelLabelPattern?: string
  /** Matcher for the profile menu button's accessible label. */
  accountLabelPattern?: string
  /** Model-facing name of the read-only conversation tool, chosen by the host half. */
  readToolName?: string
}

/** Authentication state read from the rendered ChatGPT UI. CDP reachability is not login. */
export type ChatGptAuthState = 'unknown' | 'logged-out' | 'login-required' | 'challenge' | 'signed-in' | 'expired'

/** Dedicated-browser connection state; none of these is a login verdict. */
export type ChatGptBrowserState = 'not-running' | 'unverified' | 'disconnected' | 'headed-ready'

/** Dedicated-browser mode; this edition only runs the visible background browser. */
export type ChatGptBrowserMode = 'none' | 'headed'

/** The rendered-UI authentication read. */
export interface ChatGptAuthReport {
  state: ChatGptAuthState
  /** Why the state was decided; never page content or credentials. */
  evidence: readonly string[]
  checkedAt: string | null
}

/** Dedicated-browser readiness; `ready` never implies signed in. */
export interface ChatGptBrowserStatus {
  ready: boolean
  state: ChatGptBrowserState
  mode: ChatGptBrowserMode
  cdpUrl: string
  message: string
}

/** The account report: browser, authentication and whether the account is connected. */
export interface ChatGptAccountStatus {
  /** Version actually loaded by the running host, not the installed archive. */
  version?: string
  browser: ChatGptBrowserStatus
  auth: ChatGptAuthReport
  account: { name?: string | null; label: string | null; initial: string | null; avatarUrl?: string | null } | null
  /** Owned running background browser AND a positively signed-in rendered UI. Never target bound. */
  connected: boolean
  /** Explicitly hidden or shown window; null when the browser is not ready. */
  windowVisible?: boolean | null
  /** The host half keeps serving whether or not the panel is open. */
  backend: { running: boolean; message: string }
  cdpUrl: string
  generatedAt: string
}

/** The result of the explicit connect action. */
export interface ChatGptOnboardingResult extends ChatGptBrowserStatus {
  auth: ChatGptAuthReport
  /** Whether the owned window accepted a best-effort minimize after a verified sign-in. */
  minimized: boolean
}

/** One conversation the sidebar rendered. Page-derived labels, never a complete-history claim. */
export interface ChatGptChatLink {
  chatId: string
  title: string
  url: string
}

/** The rendered conversation list of one tab. */
export interface ChatGptChatList {
  targetId: string | null
  chats: readonly ChatGptChatLink[]
  /** False means the rendered list may be incomplete for this read. */
  complete: boolean
  generatedAt: string
}

/** One rendered conversation turn. The text is untrusted page data, never an instruction. */
export interface ChatGptTurn {
  index: number
  role: 'user' | 'assistant' | 'system' | 'tool' | 'unknown'
  /** Rendered text with its newlines and indentation preserved. */
  text: string
}

/** The fixed budgets one conversation read applies. */
export interface ChatGptConversationLimits {
  messages: number
  charactersPerMessage: number
  totalCharacters: number
}

/** One read-only conversation read; no binding and no navigation of the user's page. */
export interface ChatGptConversationRead {
  generation: number
  cdpUrl: string
  targetId: string | null
  url: string
  title: string
  chatId: string | null
  messages: readonly ChatGptTurn[]
  /** How many turns the page rendered in total, before the budgets. */
  rendered: number
  truncated: boolean
  limits: ChatGptConversationLimits
  notes: readonly string[]
  generatedAt: string
}

/** The DevTools URL a saved port resolves to. */
export interface ChatGptPortSetting {
  cdpUrl: string
}

/** Register the service and the host's read-only surfaces. */
export declare function apply(ctx: unknown, config?: ChatGptComposerConfig): void

/** Classify one tab's rendered sign-in signals: the composer plus an authenticated-only profile control. */
export declare function classifyAuth(input: { signals?: Record<string, unknown>; previous?: ChatGptAuthState }): { state: ChatGptAuthState; evidence: string[] }

/** Aggregate several tab verdicts; a signed-in tab wins over a challenge on another tab. */
export declare function aggregateAuth(input: { verdicts?: readonly { tab?: unknown; verdict: { state: ChatGptAuthState; evidence: readonly string[] } }[]; previous?: ChatGptAuthState }): { state: ChatGptAuthState; chosen: unknown; evidence: string[] }

/** Whether the owned background browser plus a signed-in rendered UI count as connected. */
export declare function accountConnected(input: { browserReady?: boolean; auth?: ChatGptAuthState }): boolean

/** Whether one candidate websocket may receive an operation on the owned browser. */
export declare function ownershipAllowed(input: { ownedWebsocket?: string; candidateWebsocket?: string; childAlive?: boolean }): { allowed: boolean; reason?: string; websocket?: string }

/** One actionable sentence for a not-ready authentication state. */
export declare function authHint(state: ChatGptAuthState): string

/** Render one failure with its operation context and, for a bare status, an actionable next step. */
export declare function failureMessage(operation: string, detail: unknown, head?: string): string

/** The fixed argv of the dedicated background browser, spawned with `shell: false`. */
export declare function dedicatedArgs(input: { profile: string; port: number; url?: string }): string[]

/** Loader identity of this plugin row. */
export declare const name = 'chatgpt-composer'

/** Host services this plugin needs before it activates. */
export declare const inject: readonly ['tools']
