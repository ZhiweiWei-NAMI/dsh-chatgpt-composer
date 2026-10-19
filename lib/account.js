/**
 * Pure decisions for the dedicated-browser account flow, local read-only edition.
 *
 * This module has no process, socket, DOM or filesystem access at all: every
 * function takes facts and returns a verdict. That is what makes the
 * `not running -> interactive login -> verified ChatGPT UI -> account connected`
 * transition checkable offline, and it is also why the launcher and the host
 * half cannot "improve" the verdict by retrying.
 *
 * Hard boundaries encoded here:
 * - authentication is a **rendered-UI** observation (`signed-in`): the composer
 *   plus a control only a signed-in session renders. The composer model control
 *   is an observation, never a login requirement; DevTools reachability is never
 *   accepted as proof of login either;
 * - no cookie, token, storage or credential is read, copied or compared;
 * - there is exactly one browser mode. This edition never starts a headless
 *   browser, never hands off between modes and never asks a browser to close;
 *   the dedicated visible Chromium keeps running in the background so the
 *   account stays connected while the panel is closed.
 *
 * @module dsh-chatgpt-composer/account
 */

/** Distinct authentication states; `unknown` is an answer, never a default success. */
export const AUTH_STATES = ['unknown', 'logged-out', 'login-required', 'challenge', 'signed-in', 'expired']

/** The only state in which the rendered UI proves the account is signed in. */
export const AUTH_READY = 'signed-in'

/** Distinct dedicated-browser connection states; none of them claim a login. */
export const BROWSER_STATES = ['not-running', 'unverified', 'disconnected', 'headed-ready']

/** Dedicated-browser modes. This edition only runs the visible background browser. */
export const BROWSER_MODES = ['none', 'headed']

/**
 * Classify one tab's rendered sign-in signals.
 *
 * The verdict is deliberately conservative: an explicit challenge or sign-in
 * control wins over anything else, and `signed-in` is reported only when the
 * ChatGPT composer rendered together with a control only an authenticated session
 * renders. The composer model control is an observation and never a login
 * requirement: a modern ChatGPT UI may render the switcher without a matching
 * accessible label, and a missing model control must not turn a signed-in
 * session into `unknown`.
 * @param input - the DOM-only signals and the previously known state.
 * @param input.signals - booleans read from the tab; see `readAuthSignals` in cdp.js.
 * @param input.previous - the state reported before this read, used for `expired`.
 * @returns the state and the evidence lines behind it.
 */
export function classifyAuth({ signals, previous = 'unknown' } = {}) {
  const evidence = []
  const signedInBefore = previous === AUTH_READY || previous === 'expired'
  if (signals?.challenge === true) {
    evidence.push('the page rendered a platform verification/challenge marker; this plugin never bypasses it')
    return { state: 'challenge', evidence }
  }
  if (signals?.signIn === true || signals?.authPath === true) {
    evidence.push('the page rendered a sign-in control or sits on a /auth path, so no ChatGPT session is usable here')
    return { state: signedInBefore ? 'expired' : 'login-required', evidence }
  }
  if (signals?.authenticatedAccount === true) {
    evidence.push('已显示个人资料菜单。')
    return { state: AUTH_READY, evidence }
  }
  if (signals?.composer === true || signals?.accountControl === true) {
    evidence.push('the ChatGPT page rendered a composer or an account control but no authenticated-only profile control, so the sign-in state cannot be decided')
    return { state: 'unknown', evidence }
  }
  evidence.push('no ChatGPT composer, account control or sign-in control was readable')
  return { state: signedInBefore ? 'expired' : 'logged-out', evidence }
}

/**
 * Aggregate several tabs into one account verdict.
 *
 * A positively signed-in tab wins: this edition never closes or bypasses
 * anything, so a challenge or a sign-out on an unrelated tab must not deny an
 * account that is genuinely signed in somewhere. The challenge is still reported
 * in the evidence and is never bypassed; it becomes the verdict only when no tab
 * is signed in.
 * @param input - one verdict per readable tab, plus the fallback previous state.
 * @returns `{ state, chosen, evidence }`.
 */
export function aggregateAuth({ verdicts = [], previous = 'unknown' } = {}) {
  const pick = (state) => verdicts.find((row) => row.verdict.state === state)
  const order = [AUTH_READY, 'challenge', 'expired', 'login-required', 'logged-out', 'unknown']
  if (verdicts.length === 0) {
    return { state: previous === AUTH_READY ? 'expired' : 'unknown', chosen: undefined, evidence: ['no readable ChatGPT tab answered the account read'] }
  }
  let chosen
  for (const state of order) {
    chosen = pick(state)
    if (chosen !== undefined) break
  }
  const evidence = []
  for (const row of verdicts.slice(0, 4)) evidence.push(`${shortId(row.tab?.targetId)} ${row.verdict.state}: ${row.verdict.evidence[0] ?? 'no evidence line'}`)
  if (verdicts.length > 4) evidence.push(`and ${String(verdicts.length - 4)} further ChatGPT tab(s) were read`)
  for (const line of (chosen?.verdict.evidence ?? []).slice(1)) evidence.push(line)
  if (chosen?.verdict.state === AUTH_READY && verdicts.some((row) => row.verdict.state === 'challenge')) {
    evidence.push('another tab rendered a platform challenge; the signed-in tab is still reported, and this plugin never bypasses a challenge')
  }
  return { state: chosen?.verdict.state ?? 'unknown', chosen, evidence }
}

/**
 * Whether the account counts as connected for the panel and for the read tool.
 *
 * Being connected means the plugin owns the running dedicated browser *and* the
 * rendered ChatGPT UI positively proves a signed-in session. It never depends on
 * a DSH session, a target tab, a conversation or a model binding.
 * @param input - the launcher readiness and the rendered-UI authentication state.
 * @returns whether the account is connected.
 */
export function accountConnected({ browserReady, auth } = {}) {
  return browserReady === true && auth === AUTH_READY
}

/** One actionable sentence for a not-ready authentication state. */
export function authHint(state) {
  if (state === 'challenge') return '页面出现平台验证/挑战；请在专用浏览器里完成人机验证后重新刷新。本插件绝不绕过验证。'
  if (state === 'login-required') return '尚未检测到已登录的 ChatGPT 界面；请先在专用浏览器窗口完成网页登录，再点“刷新”。'
  if (state === 'expired') return '登录可能已经过期；请在专用浏览器里重新登录后点“刷新”。'
  if (state === 'logged-out') return '专用浏览器当前没有登录；请先在专用浏览器窗口完成网页登录，再点“刷新”。'
  return '账户状态未知：读取不到已登录的 ChatGPT 界面。请先在专用浏览器里完成登录后点“刷新”。'
}

/**
 * Whether one candidate websocket may receive an operation on the owned browser.
 * Anything that is not the exact websocket this plugin launched is refused.
 * @param input - the owned identity, the candidate and whether our child is alive.
 * @returns `{ allowed, reason?, websocket? }`.
 */
export function ownershipAllowed({ ownedWebsocket, candidateWebsocket, childAlive } = {}) {
  if (typeof ownedWebsocket !== 'string' || ownedWebsocket === '') return { allowed: false, reason: '本插件没有启动并拥有的专用浏览器身份' }
  if (ownedWebsocket !== candidateWebsocket) return { allowed: false, reason: '给定身份与本次启动输出的 DevTools websocket 不一致' }
  if (childAlive !== true) return { allowed: false, reason: '本插件拥有的专用浏览器进程已经退出' }
  return { allowed: true, websocket: ownedWebsocket }
}

/**
 * The fixed argv of the dedicated background browser. One function so the
 * launcher cannot drift on profile, port, loopback or shell use.
 * @param input - private profile directory, loopback port and start URL.
 * @returns the complete argument vector, spawned with `shell: false`.
 */
export function dedicatedArgs({ profile, port, url = 'https://chatgpt.com/' } = {}) {
  return [
    `--user-data-dir=${String(profile)}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${String(port)}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--new-window', String(url),
  ]
}

/**
 * Render one failure with its operation context and, for a bare HTTP status, an
 * actionable next step. A bare status code is never presented as a diagnosis:
 * this plugin does not know the cause from the code alone.
 * @param operation - the endpoint or step that failed.
 * @param detail - the thrown message or status text.
 * @param head - optional leading clause.
 * @returns one user-facing sentence.
 */
export function failureMessage(operation, detail, head) {
  const text = String(detail ?? '').replace(/\s+/gu, ' ').trim()
  const lead = head === undefined || head === '' ? `操作 ${operation} 未完成` : head
  const status = /^(?:HTTP\s*)?(\d{3})$/iu.exec(text)
  if (status !== null) {
    return `${lead}：${operation} 返回 HTTP ${status[1]}，没有可读的说明。本插件无法确定该状态的具体原因；请刷新页面或重载插件后重试，若仍然失败请记录 DSH 版本与操作步骤。`
  }
  return `${lead}：${text === '' ? '没有可读的错误说明' : text}（操作 ${operation}）`
}

/** Shorten a CDP target id for a status line. */
function shortId(value) {
  return typeof value === 'string' && value !== '' ? value.slice(0, 8) : 'tab'
}
