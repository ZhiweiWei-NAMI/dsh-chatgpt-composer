/**
 * Public typings for dsh-chatgpt-composer's host half.
 *
 * These declarations describe this package's own surface. They deliberately do
 * not re-declare DSH's internal types: the binding is reached at run time
 * through the generated `exports["./typert"]` artifact, and a consumer that
 * wants the typed Remote methods imports `dsh-chatgpt-composer/remote`.
 */

/** Deployment configuration; every field has a safe default. */
export interface ChatGptComposerConfig {
  /** DevTools endpoint of the browser the user already runs. Default `http://127.0.0.1:9222`. */
  cdpUrl?: string
  /** Budget for attaching to that endpoint, in milliseconds. */
  connectTimeoutMs?: number
  /** Budget for one page read, in milliseconds. */
  readTimeoutMs?: number
  /** Matcher for the composer model control's accessible label. Default `模型|model`. */
  modelLabelPattern?: string
  /** Matcher for the profile menu button's accessible label. */
  accountLabelPattern?: string
  /**
   * Whether this deployment registers the `agent/pre-step` context surface.
   * Default `true`; per-session injection still stays off until the user arms a
   * binding in the composer toggle, and a stale binding is never injected.
   */
  preStepSnapshot?: boolean
  /** Model-facing name of the read-only binding tool. Default `chatgpt_target`. */
  toolName?: string
}

/** One ChatGPT page tab, pinned by its exact CDP target id. */
export interface ChatGptTab {
  id: string
  url: string
  title: string
  chatId: string | null
}

/** One conversation link the sidebar rendered; never a complete-history claim. */
export interface ChatGptChat {
  id: string
  title: string
}

/** One model radio of the composer menu. */
export interface ChatGptModelOption {
  index: number
  text: string
  checked: boolean
}

/** One ordinary menu entry, including the thinking-effort control. */
export interface ChatGptMenuItem {
  index: number
  label: string
  text: string
  kind: 'strength' | 'item'
  sliderValue: number | null
  min: number | null
  max: number | null
}

/** The facts two reads must agree on before a target is trusted. */
export interface ChatGptFingerprint {
  targetId: string
  url: string
  chatId: string | null
  accountLabel: string | null
  accountInitial: string | null
}

/** Read-back verdicts. `unverified` is reported instead of a plausible value. */
export interface ChatGptReadbackVerdicts {
  target: 'ok' | 'unverified'
  model: 'selection-only' | 'unverified'
  account: 'unverified'
  targetKind: 'existing' | 'new'
  chatId: string | null
  modelName: string | null
  checkedModel: boolean | null
  fingerprints: { before: ChatGptFingerprint; after: ChatGptFingerprint } | null
  notes: readonly string[]
}

/** One DSH session's binding. */
export interface ChatGptBinding {
  sessionId: string
  /** `false` keeps the binding and the selection while stopping injection. */
  active: boolean
  target: {
    kind: 'existing' | 'new'
    targetId: string
    chatId: string | null
    title: string | null
    url: string
  }
  model: {
    /** Label of the checked model radio; never the strength text. */
    selectedAt: string
    name: string
    controlLabel: string
    composerText: string
    /** Rendered thinking-effort control, reported next to the model. */
    strength: string | null
  }
  account: { label: string | null; initial: string | null } | null
  createdAt: string
  updatedAt: string | null
  verifiedAt: string
  liveCheckedAt: string | null
  verification: ChatGptReadbackVerdicts
  /** A failed live check keeps the binding and stops injection. */
  stale: boolean
  staleReason: string | null
  staleAt: string | null
  cdpUrl: string
}

/** The plain tool definition this package registers through `ctx.tools.register`. */
export interface ChatGptTargetTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: { schema: Record<string, unknown>; render(args: unknown, value: unknown): { type: 'text'; text: string }[] }
  execute(args: Record<string, never>, exec: unknown): Promise<string>
}

/** Bind one DSH session to a verified ChatGPT tab, target and model. */
export declare function apply(ctx: unknown, config?: ChatGptComposerConfig): void

/** Compose the model-facing, read-only snapshot of one binding. */
export declare function snapshotText(binding: ChatGptBinding): string

/** Compare one live read against a binding; every disagreement keeps it stale. */
export declare function liveProblems(binding: ChatGptBinding, facts: unknown): string[]

/** Strip control characters and cap one page-derived value. */
export declare function sanitize(value: unknown, max?: number): string

/** Build the read-only `chatgpt_target` tool definition. */
export declare function buildTargetTool(config: { toolName: string }, service: unknown): ChatGptTargetTool

/** Register the `agent/pre-step` context surface that appends one user-role snapshot. */
export declare function registerPreStep(ctx: unknown, service: unknown): void

/** Resolve the calling session id from a tool run context. */
export declare function sessionIdOf(exec: unknown): string | undefined

/** Loader identity of this plugin row. */
export declare const name = 'chatgpt-composer'

/** Host services this plugin needs before it activates. */
export declare const inject: readonly ['tools']
