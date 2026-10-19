/**
 * CDP adapter for the plugin-owned dedicated background browser.
 *
 * Attaches to a Chromium DevTools endpoint (`http://127.0.0.1:9222` by default),
 * never launches a browser and never asks one to close — only `disconnect()`.
 * This package contains no close path at all: the dedicated browser keeps running
 * in the background so the account stays connected while the panel is closed.
 *
 * Every page access names the exact owned DevTools websocket, which is re-read
 * live before and after the read, so a replaced listener on the port is never
 * touched even when it inherited a cached attachment.
 *
 * Allowed interactions, and the only ones implemented:
 * - read what a ChatGPT tab already rendered (sidebar links, the conversation id
 *   in the URL, the composer model control, the profile label);
 * - read the rendered conversation turns as read-only untrusted page text;
 * - a page-context click on the composer model control, only to open its menu
 *   for reading, followed by Escape to close it again; nothing is selected;
 * - a read of the rendered sign-in state (composer, model control, account
 *   control, sign-in control and platform-challenge marker); it reports booleans
 *   and the account label only, and never inspects cookies, storage or tokens.
 *
 * Everything runs in the page's main world through `page.evaluate`, never
 * through `page.$`/`ElementHandle`: on a hidden tab the element-handle path was
 * measured hanging in `Runtime.callFunctionOn` until puppeteer's 180s protocol
 * budget expired, while main-world evaluation answered in milliseconds. The
 * connection therefore sets `protocolTimeout` to at least 30s for startup and
 * every wait below is bounded by a deadline.
 *
 * Never: typing, sending a message, creating or opening a conversation,
 * selecting a model, reading cookies, storage or tokens, `Network.getAllCookies`,
 * page-context `fetch` to ChatGPT's JSON endpoints, or returning composer draft
 * text or credential values.
 *
 * @module dsh-chatgpt-composer/cdp
 */

import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Default DevTools endpoint of a Chromium started with `--remote-debugging-port=9222`. */
export const DEFAULT_CDP_URL = 'http://127.0.0.1:9222'

/** Optional override naming the module to load instead of the `puppeteer-core` specifier. */
export const PUPPETEER_ENV = 'DSH_CHATGPT_COMPOSER_PUPPETEER'

/** Hosts treated as a ChatGPT web app tab. */
export const CHATGPT_HOSTS = ['chatgpt.com', 'chat.openai.com', 'www.chatgpt.com']

/** Default model-control label matcher, covering the English and Chinese UI. */
export const DEFAULT_MODEL_LABEL_PATTERN = '模型|model'

/** Default profile-button label matcher, covering the English and Chinese UI. */
export const DEFAULT_ACCOUNT_LABEL_PATTERN = 'profile|个人资料|account|账户|设置|settings'

/**
 * Matcher for the thinking-effort menu entry. A hit is reported as a strength
 * control and is never a model; a miss only downgrades the entry to "ordinary
 * menu item", which is still never a model.
 */
const STRENGTH_LABEL_PATTERN = '强度|effort|reasoning|thinking|思考'

/**
 * Matcher for a rendered sign-in control. A hit means no usable session, and is
 * the only page fact that can move the account state to `login-required`.
 */
const SIGN_IN_LABEL_PATTERN = 'log ?in|sign ?in|登录|登入'

/**
 * Matcher for a rendered platform-verification marker. It is reported so the
 * user can complete it in the dedicated browser; this plugin never bypasses it.
 */
const CHALLENGE_LABEL_PATTERN = '人机验证|验证你是人类|verify you are human|checking your browser|just a moment|unusual activity|cloudflare'

/** Bounded puppeteer protocol budget; see the module header for the measurement. */
const PROTOCOL_TIMEOUT_MS = 10_000

/** Bounded wait for the model menu to open or close. */
const MENU_WAIT_MS = 4_000

/**
 * Budgets for one conversation read. They are reported back on the wire so a
 * caller can tell an empty conversation from a truncated read.
 */
export const CONVERSATION_LIMITS = Object.freeze({ messages: 200, charactersPerMessage: 50_000, totalCharacters: 200_000 })

/** Poll interval for every bounded wait. */
const POLL_MS = 150

/** Facts returned when a page read cannot complete, so a caller never sees undefined. */
const NO_FACTS = Object.freeze({
  url: '',
  pathname: '',
  title: '',
  chatId: null,
  chats: [],
  homeEntry: false,
  modelButton: null,
  strength: null,
  menu: { open: false, models: [], items: [] },
  account: null,
  composer: { found: false, empty: true },
})

//#region page functions (serialized into the tab; no closure over this module)

/**
 * Read the facts this adapter is allowed to read. Runs in the tab's main world.
 * @param sources - compiled label patterns.
 * @returns the raw read.
 */
function readFacts(sources) {
  const collapse = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim()
  const number = (raw) => {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  const modelPattern = new RegExp(sources.model, 'iu')
  const accountPattern = new RegExp(sources.account, 'iu')
  const strengthPattern = new RegExp(sources.strength, 'iu')
  const modelButton = [...document.querySelectorAll('button,[role="button"]')].find(
    (element) => modelPattern.test(element.getAttribute('aria-label') ?? '') && element.getAttribute('aria-haspopup') !== null,
  ) ?? null
  const accountButton = [...document.querySelectorAll('button,a,[role="button"]')].find(
    (element) => accountPattern.test(`${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('data-testid') ?? ''}`),
  ) ?? null
  const menu = document.querySelector('[role="menu"]')
  const models = menu === null ? [] : [...menu.querySelectorAll('[role="menuitemradio"]')].map((element, index) => ({
    index,
    text: collapse(element.textContent),
    checked: element.getAttribute('aria-checked') === 'true',
  }))
  const items = menu === null ? [] : [...menu.querySelectorAll('[role="menuitem"]')].map((element, index) => {
    const slider = element.querySelector('[role="slider"]')
    const label = element.getAttribute('aria-label') ?? ''
    return {
      index,
      label,
      text: collapse(element.textContent),
      kind: slider !== null || strengthPattern.test(label) ? 'strength' : 'item',
      sliderValue: slider === null ? null : number(slider.getAttribute('aria-valuenow')),
      min: slider === null ? null : number(slider.getAttribute('aria-valuemin')),
      max: slider === null ? null : number(slider.getAttribute('aria-valuemax')),
    }
  })
  const strength = items.find((item) => item.kind === 'strength') ?? null
  const composer = document.querySelector('[contenteditable="true"]')
  return {
    url: location.href,
    pathname: location.pathname,
    title: collapse(document.title),
    chatId: /^\/(?:g\/[^/]+\/)?c\/([^/?#]+)/u.exec(location.pathname)?.[1] ?? null,
    chats: [...document.querySelectorAll('a[href^="/c/"]')].map((anchor) => ({
      href: anchor.getAttribute('href') ?? '',
      text: collapse(anchor.textContent),
    })),
    homeEntry: document.querySelector('a[href="/"]') !== null,
    modelButton: modelButton === null ? null : {
      controlLabel: modelButton.getAttribute('aria-label') ?? '',
      composerText: collapse(modelButton.textContent),
    },
    strength: strength === null ? null : {
      controlLabel: strength.label === '' ? null : strength.label,
      value: strength.text === '' ? null : strength.text,
      sliderValue: strength.sliderValue,
      min: strength.min,
      max: strength.max,
    },
    menu: { open: menu !== null, models, items },
    account: accountButton === null ? null : {
      label: accountButton.getAttribute('aria-label') ?? null,
      initial: collapse(accountButton.textContent).slice(0, 1) || null,
    },
    composer: { found: composer !== null, empty: composer === null ? true : collapse(composer.textContent).length === 0 },
  }
}

/**
 * Read the rendered sign-in state of one tab. Runs in the tab's main world.
 *
 * Only booleans and the profile label leave the page: no draft text, no message
 * text, no cookie, token or storage value is returned or inspected. This reader
 * never queries `input`, `textarea`, `form` or `[contenteditable]` at all, so a
 * credential field is not even looked at. A rendered composer and model control
 * also require authenticated-only account UI. The account state machine decides
 * what these facts mean.
 * @param sources - compiled label patterns.
 * @returns the raw auth signals for this tab.
 */
function readAuthSignals(sources) {
  const collapse = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim()
  const modelPattern = new RegExp(sources.model, 'iu')
  const accountPattern = new RegExp(sources.account, 'iu')
  const signInPattern = new RegExp(sources.signIn, 'iu')
  const challengePattern = new RegExp(sources.challenge, 'iu')
  const all = (selector, root = document) => [...root.querySelectorAll(selector)]
  const visible = (element) => {
    if (!element || element.getClientRects().length === 0) return false
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false
    }
    return true
  }
  // Never let quoted chat text, code, or an editable draft impersonate app UI.
  const inContent = (element) => element.closest('article,[data-message-author-role],[data-chatgpt-search-unit-key],[data-testid*="conversation-turn"],pre,code,[contenteditable],textarea') !== null
  // A composer is itself an editable, so the composer test must exclude only
  // conversation turns, never the element's own contenteditable/textarea nature.
  const inTurn = (element) => element.closest('article,[data-message-author-role],[data-testid*="conversation-turn"]') !== null
  const controls = all('button,a,[role="button"]').filter((element) => visible(element) && !inContent(element))
  const modelControl = controls.some((element) => modelPattern.test(element.getAttribute('aria-label') ?? '') && element.getAttribute('aria-haspopup') !== null)
  const accountButton = controls.find((element) => accountPattern.test(`${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('data-testid') ?? ''}`)) ?? null
  // Identify the profile MENU BUTTON, not its avatar's implementation.
  // Avatars may be an image, initials or SVG; none of those is required.
  const authenticatedButton = controls.find((element) => {
    const testId = element.getAttribute('data-testid') ?? ''
    const label = collapse(element.getAttribute('aria-label'))
    return /^(?:accounts-profile-button|profile-button|profile-menu-button)$/u.test(testId) ||
      /^(?:open\s+)?(?:profile|account|user)\s+menu$|^(?:打开|開啟)?(?:个人资料|個人資料|账户|帳戶|用户|使用者)(?:菜单|選單)$/iu.test(label)
  }) ?? null
  const isSignIn = (element) => {
    const label = collapse(element.getAttribute('aria-label') || element.textContent)
    return signInPattern.test(label) && /^(?:log\s?in|sign\s?in|登录|登入|登录 ChatGPT|Log in to ChatGPT)$/iu.test(label)
  }
  const signIn = controls.some(isSignIn)
  const trustedSignInLanding = controls.some((element) => isSignIn(element) && (
    /^(?:login-button|login-header-button)$/u.test(element.getAttribute('data-testid') ?? '') ||
    (element.getAttribute('href') === '/auth/login' && element.closest('header,nav') !== null)
  ))
  const challengeNodes = all('#challenge-form,#challenge-running,[data-testid="challenge"],[data-testid="challenge-page"],iframe[src*="challenges.cloudflare.com"]').filter((element) => visible(element) && !inContent(element))
  const challengeText = all('[role="alert"],[role="dialog"],#challenge-error-title,.cf-challenge-running,h1').some((element) => visible(element) && !inContent(element) && challengePattern.test(collapse(element.textContent)))
  const challenge = challengeNodes.length > 0 || challengeText
  // Only a positively identified composer control counts, and only when exactly
  // one is rendered. The reader never inspects its text, and it never queries an
  // `input` at all, so a credential field is out of scope by construction.
  const composers = all('#prompt-textarea,[data-testid="prompt-textarea"],textarea[data-id="root"]').filter((element) => visible(element) && !inTurn(element))
  const profile = authenticatedButton ?? accountButton
  const avatar = profile?.querySelector('img,[data-testid="avatar"],[data-slot="avatar"],.rounded-full') ?? null
  const image = avatar?.matches('img') ? avatar : avatar?.querySelector('img')
  const name = [profile?.innerText, image?.getAttribute('alt'), profile?.getAttribute('title')]
    .map(collapse).map(text => text.replace(/\s+(?:Plus|Pro|Free|Business|Team)$/iu, '').trim())
    .find(text => text && !/^(?:avatar|user|profile|account|头像|頭像|个人资料|個人資料|打开.*菜单|open.*menu)$/iu.test(text)) ?? null
  return {
    url: location.href,
    path: location.pathname,
    authPath: /^\/(?:auth|login|signin|sign-in)(?:\/|$)/iu.test(location.pathname),
    composer: composers.length === 1,
    modelControl,
    accountControl: profile !== null,
    authenticatedAccount: authenticatedButton !== null,
    accountLabel: profile?.getAttribute('aria-label') ?? null,
    accountName: name,
    accountInitial: profile === null ? null : (collapse(profile.textContent).slice(0, 1) || null),
    accountAvatarUrl: (() => {
      const image = profile?.querySelector('img')
      const src = image?.currentSrc || image?.getAttribute('src')
      if (!src) return null
      try { const url = new URL(src, location.href); return url.protocol === 'https:' ? url.href : null } catch { return null }
    })(),
    signIn,
    trustedSignInLanding,
    challenge,
  }
}

/**
 * Read the conversation turns a ChatGPT tab already rendered. Runs in the tab's
 * main world.
 *
 * This is the only reader that returns page prose, and it returns rendered
 * turns only: the composer's draft and every credential field are out of scope.
 * The host sanitizes and labels the text as untrusted data before use.
 * @param limits - message count and character budgets.
 * @returns the rendered turns plus an honest truncation verdict.
 */
function readHistoryLinks({ scroll = false } = {}) {
  const chats = []
  const links = [...document.querySelectorAll('a[href]')].filter((link) => {
    if (link.closest('main,article,[data-chatgpt-conversation-selection-target]')) return false
    const path = new URL(link.href, location.href).pathname
    return /^\/(?:g\/[^/]+\/)?c\/[^/]+$/u.test(path)
  })
  for (const link of links) {
    const url = new URL(link.href, location.href)
    if (url.origin !== location.origin) continue
    const title = (link.innerText || link.getAttribute('aria-label') || '').replace(/\s+/gu, ' ').trim()
    if (title) chats.push({ chatId: url.pathname.split('/').at(-1), title, url: url.href })
  }
  let scroller = null
  for (const link of links) {
    for (let node = link.parentElement; node && node !== document.body; node = node.parentElement) {
      if (/(auto|scroll)/u.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) { scroller = node; break }
    }
    if (scroller) break
  }
  const atBottom = !scroller || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4
  if (scroll && scroller) scroller.scrollTop += Math.max(200, scroller.clientHeight * 0.85)
  return { chats, atBottom, height: scroller?.scrollHeight ?? 0, position: scroller?.scrollTop ?? 0 }
}

function readConversationTurns(limits) {
  // Titles and labels are single-line; message text is not, and keeps its
  // newlines and indentation so rendered code is not corrupted.
  const collapse = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim()
  const messageText = (value) => String(value ?? '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/gu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/[ \t]+$/gmu, '')
    .replace(/^\n+/u, '')
    .replace(/\n+$/u, '')
  const visible = (element) => {
    if (element.getClientRects().length === 0) return false
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
    }
    return true
  }
  const outermost = (selector) => [...document.querySelectorAll(selector)].filter((element) => visible(element) && element.parentElement?.closest(selector) == null)
  let nodes = outermost('[data-message-author-role]')
  if (nodes.length === 0) nodes = outermost('article[data-testid^="conversation-turn"]')
  if (nodes.length === 0) nodes = outermost('[data-chatgpt-conversation-selection-target] [data-chatgpt-search-unit-key]')
  const role = (element) => {
    const unitRole = /:(user|assistant|system|tool)$/u.exec(element.getAttribute('data-chatgpt-search-unit-key') ?? '')?.[1]
    if (unitRole) return unitRole
    const raw = String(element.getAttribute('data-message-author-role') ?? '').trim().toLowerCase()
    if (raw === 'user' || raw === 'assistant' || raw === 'system' || raw === 'tool') return raw
    const testId = String(element.getAttribute('data-testid') ?? '')
    if (/user/iu.test(testId)) return 'user'
    if (/assistant/iu.test(testId)) return 'assistant'
    return 'unknown'
  }
  const rendered = nodes.length
  const kept = nodes.slice(Math.max(0, rendered - limits.messages))
  const keptStart = rendered - kept.length
  const messages = []
  let total = 0
  let truncated = kept.length < rendered
  for (const [offset, element] of kept.entries()) {
    const content = element.querySelector('[data-content-search-unit-key]') ?? element
    const raw = typeof content.innerText === 'string' ? content.innerText : String(content.textContent ?? '')
    let text = messageText(raw)
    if (text.length > limits.charactersPerMessage) {
      text = text.slice(0, limits.charactersPerMessage)
      truncated = true
    }
    if (total + text.length > limits.totalCharacters) {
      const room = Math.max(0, limits.totalCharacters - total)
      if (room === 0) { truncated = true; break }
      text = text.slice(0, room)
      truncated = true
    }
    total += text.length
    messages.push({ index: keptStart + offset, role: role(element), text })
    if (total >= limits.totalCharacters && offset < kept.length - 1) { truncated = true; break }
  }
  return {
    url: location.href,
    pathname: location.pathname,
    title: collapse(document.title),
    chatId: /^\/(?:g\/[^/]+\/)?c\/([^/?#]+)/u.exec(location.pathname)?.[1] ?? null,
    rendered,
    messages,
    truncated,
  }
}

/**
 * Click the composer model control in the tab's main world.
 * @param sources - compiled label patterns.
 * @returns whether the control was found and clicked.
 */
function clickModelButton(sources) {
  const modelPattern = new RegExp(sources.model, 'iu')
  const button = [...document.querySelectorAll('button,[role="button"]')].find(
    (element) => modelPattern.test(element.getAttribute('aria-label') ?? '') && element.getAttribute('aria-haspopup') !== null,
  )
  if (button === undefined) return false
  button.click()
  return true
}

/**
 * Dispatch a synthetic Escape for a menu that survived the protocol key press.
 * @returns nothing.
 */
function syntheticEscape() {
  for (const target of [document.activeElement, document, document.body]) {
    if (target === null || target === undefined) continue
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }))
    target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }))
  }
}

//#endregion

//#region helpers

/** Race one promise against a deadline; a late response is discarded by the caller. */
function withDeadline(promise, ms, label) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    if (typeof timer.unref === 'function') timer.unref()
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

/** Sleep for one bounded wait step. */
function sleep(ms) {
  return new Promise((done) => {
    const timer = setTimeout(done, ms)
    if (typeof timer.unref === 'function') timer.unref()
  })
}

/** Normalize a model label for comparison. */
/** Ambiguous checked radios must never count as a verified selection. */
function uniqueCheckedModel(models) {
  const checked = models.filter((model) => model.checked === true)
  return checked.length === 1 ? checked[0] : null
}

/**
 * Parse the DevTools base URL.
 * @param value - operator-supplied `cdpUrl`.
 * @returns the parsed origins used by discovery and by puppeteer.connect.
 * @throws {Error} when the value is not a loopback HTTP(S) URL.
 */
export function parseCdpUrl(value) {
  let url
  try {
    url = new URL(String(value))
  } catch {
    throw new Error(`chatgpt-composer: cdpUrl is not a URL: ${String(value)}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`chatgpt-composer: cdpUrl must be http(s): ${String(value)}`)
  }
  const host = url.hostname
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1' && host !== '[::1]') {
    throw new Error(`chatgpt-composer: cdpUrl must point at a loopback DevTools endpoint, got ${host}`)
  }
  const base = `${url.protocol}//${url.host}`
  return { base, versionPath: `${base}/json/version`, listPath: `${base}/json/list` }
}

/**
 * Conversation id of a `/c/<id>` URL or of the relative `/c/<id>` href a
 * sidebar link carries.
 * @param raw - one page URL or rendered link href.
 * @returns the conversation id, or undefined on the ChatGPT root.
 */
export function chatIdOfUrl(raw) {
  const value = String(raw ?? '')
  let pathname = value
  if (!value.startsWith('/')) {
    try {
      pathname = new URL(value).pathname
    } catch {
      return undefined
    }
  }
  const match = /^\/(?:g\/[^/]+\/)?c\/([^/?#]+)/u.exec(pathname)
  return match === null ? undefined : match[1]
}

/**
 * Whether one CDP target row is an ordinary ChatGPT web page.
 * @param row - a `/json/list` row or a `{ type, url }` projection of a page.
 * @param hosts - allowed host suffixes.
 * @returns whether the target is a page-type ChatGPT tab.
 */
export function isChatGptTarget(row, hosts = CHATGPT_HOSTS) {
  if (row.type !== undefined && row.type !== 'page') return false
  try {
    const url = new URL(String(row.url ?? ''))
    return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === '' && hosts.includes(url.hostname)
  } catch {
    return false
  }
}

/**
 * Normalize the raw DOM read into the facts this plugin reports.
 * Kept separate from the page function so the reduction is unit-checkable.
 * @param raw - the `page.evaluate` result.
 * @param patterns - compiled label matchers plus the strength matcher source.
 * @param targetId - resolved CDP target id of the tab that was read.
 * @returns normalized read-only facts plus per-source diagnostics.
 */
export function normalizeRead(raw, patterns, targetId) {
  const facts = raw ?? NO_FACTS
  const notes = []
  const chats = []
  for (const row of facts.chats ?? []) {
    const id = chatIdOfUrl(row.href)
    if (id === undefined) continue
    const title = typeof row.text === 'string' && row.text.trim() !== '' ? row.text.trim() : '(untitled)'
    if (chats.some((chat) => chat.id === id)) continue
    chats.push({ id, title })
  }
  if (chats.length === 0) notes.push('chats: the sidebar rendered no /c/ link, so no existing chat can be listed for this tab')
  const models = facts.menu?.models ?? []
  const items = facts.menu?.items ?? []
  if (facts.modelButton === null || facts.modelButton === undefined) {
    notes.push(`model: no composer control matched /${patterns.model.source}/u with aria-haspopup; the model stays unknown rather than guessed`)
  } else {
    notes.push('model: the composer control text may combine the model with the thinking effort, so the model name is read from the menu only')
  }
  if (facts.menu?.open === true) {
    const checked = models.find((model) => model.checked === true)
    notes.push(checked === undefined
      ? `model-menu: ${String(models.length)} model radio(s) rendered, none reporting aria-checked=true`
      : `model-menu: ${String(models.length)} model radio(s) rendered; aria-checked=true is ${JSON.stringify(checked.text)}`)
  }
  if (items.some((item) => item.kind === 'strength')) notes.push('strength: the menu exposes a thinking-effort control; it is reported separately and is never a model')
  if (items.some((item) => item.kind === 'item')) notes.push('model-menu: plain role=menuitem entries are reported as ordinary controls, never as models')
  notes.push('account: the page exposes only the profile menu label and its avatar initial; the identity stays unverified')
  return {
    targetId: targetId ?? null,
    url: String(facts.url ?? ''),
    title: String(facts.title ?? ''),
    chatId: facts.chatId === null || facts.chatId === undefined ? null : String(facts.chatId),
    chats,
    modelButton: facts.modelButton === null || facts.modelButton === undefined
      ? null
      : { ...facts.modelButton, strength: facts.strength ?? null },
    menu: { open: facts.menu?.open === true, models, items },
    account: facts.account ?? null,
    composer: facts.composer ?? { found: false, empty: true },
    notes,
    labelPatterns: { model: patterns.model.source, account: patterns.account.source },
  }
}

/**
 * Render the thinking-effort control as one short label, or null when the menu
 * was not read. It is reported next to the model and never as the model.
 * @param strength - the strength facts of a read.
 * @returns the label, capped for a wire payload.
 */
export function strengthLabel(strength) {
  if (strength === null || strength === undefined) return null
  const parts = [strength.controlLabel, strength.value].filter((part) => typeof part === 'string' && part !== '')
  if (parts.length === 0 && strength.sliderValue !== null && strength.sliderValue !== undefined) parts.push(String(strength.sliderValue))
  return parts.length === 0 ? null : parts.join(' ').replace(/\s+/gu, ' ').trim().slice(0, 80)
}

/**
 * One tab's stable identity: the exact CDP target id, its URL and the account
 * label-level facts. A target choice is only trusted when two of these agree.
 * @param facts - a normalized or raw read.
 * @param targetId - resolved CDP target id.
 * @returns the fingerprint.
 */
export function fingerprintOf(facts, targetId) {
  return {
    targetId: String(targetId ?? ''),
    url: String(facts?.url ?? ''),
    chatId: facts?.chatId === null || facts?.chatId === undefined ? null : String(facts.chatId),
    accountLabel: facts?.account?.label ?? null,
    accountInitial: facts?.account?.initial ?? null,
  }
}

//#endregion

/** One memoized connection, generation-tagged reads, bounded waits. */
export class CdpAdapter {
  #cdpUrl
  #connectTimeoutMs
  #readTimeoutMs
  #modelLabelPattern
  #accountLabelPattern
  #hosts
  #logger
  #browser
  #connecting
  #generation = 0
  #puppeteer
  #readerPage
  #historyPage
  #history = new Map()
  #accountRevision = 0
  #watchedAccounts = new WeakSet()
  #backgroundSessions = new WeakMap()

  async #keepBackgroundActive(page) {
    if (this.#backgroundSessions.has(page)) return
    const session = await page.createCDPSession()
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await session.send('Page.setWebLifecycleState', { state: 'active' })
    this.#backgroundSessions.set(page, session)
  }

  get accountRevision() { return this.#accountRevision }

  async #watchAccount(page) {
    const marker = 'dsh-composer-account-changed'
    if (!this.#watchedAccounts.has(page)) {
      this.#watchedAccounts.add(page)
      page.on('console', message => { if (message.type() === 'debug' && message.text() === marker) this.#accountRevision++ })
      page.on('close', () => { this.#accountRevision++ })
      page.on('framenavigated', frame => { if (frame.parentFrame() === null) this.#accountRevision++ })
    }
    await this.#evaluate(page, function (marker) {
      const read = () => {
        const controls = [...document.querySelectorAll('button,a,[role="button"]')].filter(e => !e.closest('article,[data-chatgpt-search-unit-key],pre,code,[contenteditable]'))
        const profile = controls.find(e => /^(?:accounts-profile-button|profile-button|profile-menu-button)$/u.test(e.dataset.testid || '') || /^(?:打开|開啟)?(?:个人资料|個人資料)(?:菜单|選單)$|^(?:open )?profile menu$/iu.test(e.getAttribute('aria-label') || ''))
        const loggedOut = controls.some(e => /^(?:login-button|login-header-button)$/u.test(e.dataset.testid || '') || e.getAttribute('href') === '/auth/login')
        const challenge = !!document.querySelector('#challenge-form,#challenge-running,[data-testid="challenge-page"]')
        return profile ? JSON.stringify([profile.innerText, profile.querySelector('img')?.getAttribute('src'), loggedOut, challenge]) : loggedOut || challenge ? JSON.stringify([loggedOut, challenge]) : null
      }
      let previous = read(), queued = false
      const observer = new MutationObserver(() => {
        if (queued) return
        queued = true
        setTimeout(() => {
          queued = false
          const next = read()
          // A hidden/minimized page losing layout is not evidence of logout.
          if (next !== null && next !== previous) { previous = next; console.debug(marker) }
        }, 100)
      })
      window.__dshComposerAccountObserver?.disconnect()
      window.__dshComposerAccountObserver = observer
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'data-testid', 'aria-label'] })
    }, marker, 'observe account changes')
  }

  /**
   * @param options - adapter bounds, label matchers and diagnostics.
   * @param options.cdpUrl - DevTools endpoint of the already-running browser.
   * @param options.connectTimeoutMs - `puppeteer.connect` budget.
   * @param options.readTimeoutMs - per-read budget.
   * @param options.modelLabelPattern - matcher for the composer model control.
   * @param options.accountLabelPattern - matcher for the profile menu button.
   * @param options.hosts - accepted ChatGPT hostnames; the fixture harness narrows it.
   * @param options.logger - Cordis logger, or a console-shaped stand-in.
   */
  constructor({
    cdpUrl = DEFAULT_CDP_URL,
    connectTimeoutMs = 8000,
    readTimeoutMs = 12000,
    modelLabelPattern = DEFAULT_MODEL_LABEL_PATTERN,
    accountLabelPattern = DEFAULT_ACCOUNT_LABEL_PATTERN,
    hosts = CHATGPT_HOSTS,
    logger,
  } = {}) {
    this.#cdpUrl = parseCdpUrl(cdpUrl)
    this.#connectTimeoutMs = connectTimeoutMs
    this.#readTimeoutMs = readTimeoutMs
    this.#modelLabelPattern = compile(modelLabelPattern, 'modelLabelPattern')
    this.#accountLabelPattern = compile(accountLabelPattern, 'accountLabelPattern')
    this.#hosts = Array.isArray(hosts) && hosts.length > 0 ? [...hosts] : [...CHATGPT_HOSTS]
    this.#logger = logger
  }

  /** The endpoint this adapter attaches to, for status reporting. */
  get cdpUrl() {
    return this.#cdpUrl.base
  }

  /** Monotonic read generation; a caller compares it to drop stale responses. */
  get generation() {
    return this.#generation
  }

  /** The label matchers in force, for status reporting. */
  get labelPatterns() {
    return { model: this.#modelLabelPattern.source, account: this.#accountLabelPattern.source }
  }

  /**
   * Resolve the public `puppeteer-core` module lazily, so a missing copy fails
   * only the operation that needs a browser.
   * @returns the puppeteer-core namespace.
   * @throws {Error} naming the missing dependency and the override.
   */
  async #loadPuppeteer() {
    if (this.#puppeteer !== undefined) return this.#puppeteer
    const override = globalThis.process?.env?.[PUPPETEER_ENV]
    const specifier = override === undefined || override === '' ? 'puppeteer-core' : override
    try {
      const loaded = isAbsolute(specifier) || specifier.startsWith('.')
        ? await import(pathToFileURL(resolve(specifier)).href)
        : await import(specifier)
      this.#puppeteer = loaded.default ?? loaded
    } catch (error) {
      throw new Error(
        `chatgpt-composer: the public package "puppeteer-core" is not resolvable from this install (${error instanceof Error ? error.message : String(error)}); declare it as a dependency or point ${PUPPETEER_ENV} at an existing copy`,
      )
    }
    if (typeof this.#puppeteer?.connect !== 'function') throw new Error('chatgpt-composer: puppeteer-core does not expose connect()')
    return this.#puppeteer
  }

  /**
   * Discovery read over the DevTools HTTP endpoint only: no page execution, no
   * credential. Always answers with a `chatgptTabs` array, empty on failure, so
   * the wire shape never depends on whether the browser was reachable.
   *
   * Enumeration is gated on ownership: the `/json/version` handshake must report
   * the exact owned websocket before `/json/list` is requested at all, so a
   * foreign or replaced listener on the configured port can never leak its tab
   * titles, URLs or conversation ids through this endpoint.
   * @param expectedWebSocket - exact identity of the plugin-owned browser.
   * @returns browser facts plus the ChatGPT page tabs of the owned browser only.
   */
  async probe(expectedWebSocket) {
    if (typeof expectedWebSocket !== 'string' || expectedWebSocket.trim() === '') throw new Error('缺少专用浏览器身份，拒绝枚举浏览器标签页。')
    const generation = ++this.#generation
    let version
    try {
      version = await withDeadline(this.#getJson(this.#cdpUrl.versionPath), this.#connectTimeoutMs, 'cdp /json/version')
    } catch (error) {
      return {
        generation,
        cdpUrl: this.#cdpUrl.base,
        reachable: false,
        browser: null,
        protocolVersion: null,
        chatgptTabs: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
    // Ownership handshake only: a mismatching identity ends the read here, and
    // /json/list is never requested for a browser this plugin does not own.
    if (version?.webSocketDebuggerUrl !== expectedWebSocket) {
      return {
        generation,
        cdpUrl: this.#cdpUrl.base,
        reachable: false,
        browser: null,
        protocolVersion: null,
        chatgptTabs: [],
        error: '端口上的浏览器不是本插件启动并拥有的（DevTools 身份不一致）；未枚举任何标签页，也未读取任何标题、URL 或会话 id。',
      }
    }
    let rows = []
    let listError = null
    try {
      const list = await withDeadline(this.#getJson(this.#cdpUrl.listPath), this.#connectTimeoutMs, 'cdp /json/list')
      rows = Array.isArray(list) ? list.filter((row) => isChatGptTarget(row, this.#hosts)) : []
    } catch (error) {
      listError = error instanceof Error ? error.message : String(error)
    }
    return {
      generation,
      cdpUrl: this.#cdpUrl.base,
      reachable: true,
      browser: typeof version.Browser === 'string' ? version.Browser : null,
      protocolVersion: typeof version['Protocol-Version'] === 'string' ? version['Protocol-Version'] : null,
      chatgptTabs: rows.map((row) => ({
        id: typeof row.id === 'string' ? row.id : '',
        url: String(row.url ?? ''),
        title: typeof row.title === 'string' ? row.title : '',
        chatId: chatIdOfUrl(row.url) ?? null,
      })),
      error: listError,
    }
  }

  /**
   * Read one ChatGPT tab without touching it.
   * @param options - `targetId` of the tab; omitted reads the first ChatGPT tab.
   * @returns normalized read-only facts for that tab.
   */
  async readState({ targetId, expectedWebSocket } = {}) {
    const generation = ++this.#generation
    const { page, targetId: resolved } = await this.#page(targetId, expectedWebSocket)
    const facts = await this.#evaluate(page, readFacts, this.#sources(), 'cdp readState')
    return {
      generation,
      cdpUrl: this.#cdpUrl.base,
      ...normalizeRead(facts, { model: this.#modelLabelPattern, account: this.#accountLabelPattern }, resolved),
    }
  }

  /**
   * Explicitly open the composer model menu, read it, close it and verify the
   * close. Selects nothing.
   * @param options - the tab to act on.
   * @returns the menu contents read between the open and the close.
   */
  async readModelMenu({ targetId, expectedWebSocket } = {}) {
    const { page, targetId: resolved } = await this.#page(targetId, expectedWebSocket)
    const sources = this.#sources()
    const opened = await this.#openMenu(page, sources)
    const notes = []
    const models = opened.facts.menu.models
    const items = opened.facts.menu.items
    const checkedModel = uniqueCheckedModel(models)
    if (models.length === 0) notes.push('model-menu: the open menu rendered no role=menuitemradio option')
    else if (checkedModel === null) notes.push('model-menu: no model radio reports aria-checked=true')
    if (items.some((item) => item.kind === 'strength')) notes.push('strength: a thinking-effort control is reported separately and is never a model')
    const plain = items.filter((item) => item.kind === 'item')
    if (plain.length > 0) notes.push(`model-menu: ${String(plain.length)} plain menu entry/entries (${plain.map((item) => item.label || item.text || '(unlabelled)').join(', ')}) are ordinary controls, not models`)
    const closed = await this.#closeMenu(page, sources)
    return {
      targetId: resolved,
      url: opened.facts.url,
      opened: opened.facts.menu.open === true,
      closed: closed.closed,
      modelControlLabel: opened.facts.modelButton?.controlLabel ?? null,
      composerText: opened.facts.modelButton?.composerText ?? '',
      strength: opened.facts.strength ?? null,
      models,
      checkedModel,
      items,
      notes,
      readAt: new Date().toISOString(),
    }
  }

  /**
   * Read the conversation turns one ChatGPT tab already rendered, as read-only
   * page text. This is the only reader that returns prose: it never types, never
   * sends, never creates or opens a conversation and never selects a model. The
   * composer's own draft text and any credential field stay out of scope.
   * @param options - the tab and the exact owned DevTools websocket.
   * @returns the rendered turns, their budgets and an honest truncation verdict.
   */
  async historyPreview({ targetId, expectedWebSocket } = {}) {
    const { page, targetId: resolved } = await this.#page(targetId, expectedWebSocket)
    const read = await this.#evaluate(page, readHistoryLinks, {}, 'read history', () => this.#assertIdentity(this.#browser, expectedWebSocket))
    for (const chat of read.chats) this.#history.set(chat.chatId, chat)
    return { targetId: resolved, chats: [...this.#history.values()] }
  }

  async listChats({ targetId, expectedWebSocket, onProgress } = {}) {
    const { page, targetId: resolved } = await this.#page(targetId, expectedWebSocket)
    const browser = await this.#connect()
    await this.#assertIdentity(browser, expectedWebSocket)
    await this.#keepBackgroundActive(page)
    // Reuse the existing sidebar; no new tab, navigation or history search.
    let chats = []
    for (let i = 0; i < 10; i++) {
      const read = await this.#evaluate(page, readHistoryLinks, {}, 'read recent history', () => this.#assertIdentity(browser, expectedWebSocket))
      chats = [...new Map(read.chats.map(chat => [chat.chatId, chat])).values()].slice(0, 20)
      if (chats.length > 0) break
      await sleep(500)
    }
    return { targetId: resolved, chats, complete: false, generatedAt: new Date().toISOString() }
  }

  async readConversation({ targetId, chatId, expectedWebSocket } = {}) {
    const generation = ++this.#generation
    let { page, targetId: resolved } = await this.#page(targetId, expectedWebSocket)
    if (chatId !== undefined && chatIdOfUrl(page.url()) !== chatId) {
      if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(chatId)) throw new Error('无效会话 ID')
      const browser = await this.#connect()
      await this.#assertIdentity(browser, expectedWebSocket)
      if (!this.#readerPage || this.#readerPage.isClosed()) this.#readerPage = await browser.newPage()
      page = this.#readerPage
      await page.waitForFrame(frame => frame.parentFrame() === null, { timeout: 30000 })
      await this.#keepBackgroundActive(page)
      await this.#assertIdentity(browser, expectedWebSocket)
      await page.goto(`https://chatgpt.com/c/${encodeURIComponent(chatId)}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await this.#assertIdentity(browser, expectedWebSocket)
      const info = await this.#targetInfoOf(page, true)
      if (chatIdOfUrl(info.url) !== chatId || !isChatGptTarget({ type: 'page', url: info.url }, this.#hosts)) throw new Error('无法打开指定历史会话')
      resolved = info.id
    }
    await this.#keepBackgroundActive(page)
    let raw
    let previousBody = ''
    let stableBody = 0
    let ready = false
    const deadline = Date.now() + 30000
    do {
      try {
        raw = await this.#evaluate(page, readConversationTurns, CONVERSATION_LIMITS, 'cdp readConversation', () => this.#assertIdentity(this.#browser, expectedWebSocket))
      } catch (error) {
        // ChatGPT may replace the document while redirecting a project chat.
        if (!/Execution context was destroyed|Cannot find context with specified id/u.test(error instanceof Error ? error.message : String(error))) throw error
        await sleep(500)
        continue
      }
      const body = JSON.stringify([raw.chatId, raw.messages])
      stableBody = body === previousBody ? stableBody + 1 : 0
      previousBody = body
      const loading = raw.messages.some(row => row.role === 'assistant' && /^(?:ChatGPT\s*说[：:]?)?\s*$/u.test(row.text.trim()))
      const matches = chatId === undefined ? raw.chatId !== null : raw.chatId === chatId
      if (matches && raw.rendered > 0 && !loading && stableBody >= 4) { ready = true; break }
      await sleep(500)
    } while (Date.now() < deadline)
    if (chatId && raw?.chatId !== chatId) throw new Error('指定会话尚未加载完成，请稍后重试。')
    if (!raw?.messages?.some(message => message.text.trim() !== '')) throw new Error('未读取到会话正文，未生成上下文附件。请确认该会话可正常打开。')
    if (!ready) throw new Error('会话正文仍在加载，未发送不完整的上下文。请稍后重试。')
    const notes = []
    const rendered = Number.isInteger(raw?.rendered) ? raw.rendered : 0
    const messages = (Array.isArray(raw?.messages) ? raw.messages : []).map((row) => ({
      index: Number.isInteger(row?.index) ? row.index : 0,
      role: ['user', 'assistant', 'system', 'tool', 'unknown'].includes(row?.role) ? row.role : 'unknown',
      text: String(row?.text ?? ''),
    }))
    if (rendered === 0) notes.push('conversation: no rendered message turn matched [data-message-author-role] or article[data-testid^="conversation-turn"] in this tab')
    else if (raw?.truncated === true) notes.push(`conversation: only ${String(messages.length)} of ${String(rendered)} rendered turn(s) were returned within the size budget`)
    if (messages.some((row) => row.role === 'unknown')) notes.push('conversation: some rendered turns expose no author role and are reported as unknown')
    notes.push('conversation: rendered page text only, labelled untrusted data downstream; the composer draft is never read here')
    return {
      generation,
      cdpUrl: this.#cdpUrl.base,
      targetId: resolved,
      url: String(raw?.url ?? ''),
      title: String(raw?.title ?? ''),
      chatId: typeof raw?.chatId === 'string' && raw.chatId !== '' ? raw.chatId : null,
      messages,
      rendered,
      truncated: raw?.truncated === true,
      limits: { ...CONVERSATION_LIMITS },
      notes,
      generatedAt: new Date().toISOString(),
    }
  }

  /**
   * Read rendered account controls until one signed-in page is found. When the
   * name is hidden, briefly open/close only its profile menu; never navigate,
   * select an account or read credentials. An unreadable tab does not fail the
   * whole read, so the account status can stay
   * honest about a partially readable browser.
   * @param expectedWebSocket - exact identity of the plugin-owned browser.
   * @returns the generation and one entry per page, including unsafe/error rows.
   */
  async readAuthAll(expectedWebSocket) {
    if (typeof expectedWebSocket !== 'string' || expectedWebSocket.trim() === '') throw new Error('缺少专用浏览器身份，拒绝读取账户页面。')
    const generation = ++this.#generation
    // Check a cached attachment too: never enumerate or evaluate the browser
    // that happened to occupy the configured port on an earlier operation.
    if (this.#browser !== undefined) await this.#assertIdentity(this.#browser, expectedWebSocket)
    const browser = await this.#connect()
    await this.#assertIdentity(browser, expectedWebSocket)
    const pages = await this.#chatPages(browser)
    await this.#assertIdentity(browser, expectedWebSocket)
    const tabs = []
    for (const page of pages) {
      let targetId = ''
      let url = ''
      try {
        await this.#assertIdentity(browser, expectedWebSocket)
        const info = await this.#targetInfoOf(page, true)
        if (info === undefined) throw new Error('the page target identity is unreadable; the page was not read')
        targetId = info.id
        url = info.url !== '' ? info.url : page.url()
        if (!isChatGptTarget({ type: 'page', url }, this.#hosts)) throw new Error('non-ChatGPT or unknown page is not read')
        await this.#assertIdentity(browser, expectedWebSocket)
        await this.#keepBackgroundActive(page)
        const signals = await this.#evaluate(page, readAuthSignals, this.#sources(), 'cdp readAuthSignals', () => this.#assertIdentity(browser, expectedWebSocket))
        if (signals.authenticatedAccount && !signals.accountName && !signals.signIn && !signals.challenge) {
          const button = await page.$('button[aria-label="打开个人资料菜单"],button[aria-label="Open profile menu"],button[aria-label="Open account menu"],button[data-testid="profile-menu-button"],button[data-testid="accounts-profile-button"]')
          if (button) {
            const { id, open } = await button.evaluate(e => ({ id: e.id, open: e.getAttribute('aria-expanded') === 'true' }))
            try {
              // Radix opens on pointer-down, not a synthetic DOM click.
              if (!open) await button.click()
              signals.accountName = await this.#evaluate(page, async function (id) {
                for (let i = 0; i < 10; i++) {
                  const menu = [...document.querySelectorAll('[role="menu"]')].find(e => e.getAttribute('aria-labelledby') === id)
                  const name = menu?.querySelector('[data-testid="workspace-switcher-trigger"] > span')?.textContent?.trim()
                  if (name) return name
                  await new Promise(resolve => setTimeout(resolve, 100))
                }
                return null
              }, id, 'read profile name', () => this.#assertIdentity(browser, expectedWebSocket))
            } finally {
              if (!open && await button.evaluate(e => e.getAttribute('aria-expanded') === 'true')) await page.keyboard.press('Escape')
              await button.dispose()
            }
          }
        }
        await this.#watchAccount(page)
        // A minimized Chromium can return blank pixels or stall screenshots.
        // Reuse the actual rendered image URL instead of capturing its window.
        tabs.push({ targetId, url: typeof signals.url === 'string' ? signals.url : url, signals, error: null })
        if (signals.authenticatedAccount && !signals.signIn && !signals.challenge) break
      } catch (error) {
        tabs.push({ targetId, url, signals: null, error: error instanceof Error ? error.message : String(error) })
      }
    }
    await this.#assertIdentity(browser, expectedWebSocket)
    return { generation, cdpUrl: this.#cdpUrl.base, tabs }
  }

  /**
   * Read the tab a binding pins, so the caller can decide whether the binding
   * still describes it. Pure read: no click, no navigation.
   * @param options - the pinned target id.
   * @returns the resolved target id and the tab's current facts.
   */
  async recheck({ targetId, expectedWebSocket } = {}) {
    const generation = ++this.#generation
    const { page, targetId: resolved } = await this.#page(targetId, expectedWebSocket)
    const facts = await this.#evaluate(page, readFacts, this.#sources(), 'cdp recheck')
    return { generation, cdpUrl: this.#cdpUrl.base, ...normalizeRead(facts, { model: this.#modelLabelPattern, account: this.#accountLabelPattern }, resolved) }
  }

  /**
   * Release the attachment. Only `disconnect()` runs; the browser keeps running
   * with all its tabs.
   * @returns completion of the detach.
   */
  /** Explicit onboarding only, after launcher verifies ownership of the endpoint. */
  async openLoginPage(expectedWebSocket) {
    if (typeof expectedWebSocket !== 'string' || !expectedWebSocket) throw new Error('缺少专用浏览器身份，请重新打开。')
    const browser = await this.#connect(30000)
    if (browser.wsEndpoint() !== expectedWebSocket) {
      await this.disconnect()
      throw new Error('浏览器连接身份与专用浏览器不一致；未操作任何页面，请重新打开。')
    }
    // Cold browser startup may need longer than the normal read/connect budget.
    const loginTimeoutMs = Math.max(30000, this.#connectTimeoutMs, this.#readTimeoutMs)
    // Select by CDP target metadata first. browser.pages() initializes unrelated
    // extension/startup tabs too; one unfinished tab used to stall the whole login.
    const target = await browser.waitForTarget(target => target.type() === 'page' && isChatGptTarget({ url: target.url() }, this.#hosts), { timeout: loginTimeoutMs })
    const page = await withDeadline(target.page(), loginTimeoutMs, 'login page')
    if (!page) throw new Error('ChatGPT 页面尚未就绪，请稍后重试。')
    await page.waitForFrame(frame => frame.parentFrame() === null && isChatGptTarget({ url: frame.url() }, this.#hosts), { timeout: loginTimeoutMs })
    await this.#assertIdentity(browser, expectedWebSocket)
    await withDeadline(page.bringToFront(), loginTimeoutMs, 'login foreground')
  }

  async #chatPages(browser) {
    const timeout = Math.max(30000, this.#connectTimeoutMs)
    const targets = browser.targets().filter(target => target.type() === 'page' && isChatGptTarget({ url: target.url() }, this.#hosts))
    const pages = []
    for (const target of targets) {
      try {
        const page = await withDeadline(target.page(), timeout, 'ChatGPT page initialization')
        if (!page || page.isClosed()) continue
        await page.waitForFrame(frame => frame.parentFrame() === null && isChatGptTarget({ url: frame.url() }, this.#hosts), { timeout })
        pages.push(page)
      } catch (error) {
        if (browser.connected !== true) throw error
        this.#logger?.warn?.('chatgpt-composer: skipped unready ChatGPT tab: %s', error instanceof Error ? error.message : String(error))
      }
    }
    return pages
  }

  async disconnect() {
    const browser = this.#browser
    this.#browser = undefined
    this.#connecting = undefined
    this.#accountRevision++
    if (browser === undefined) return
    try {
      browser.disconnect()
    } catch (error) {
      this.#logger?.warn?.('chatgpt-composer: CDP disconnect failed: %o', error)
    }
  }

  /** The compiled label sources handed to the page functions. */
  #sources() {
    return {
      model: this.#modelLabelPattern.source,
      account: this.#accountLabelPattern.source,
      strength: STRENGTH_LABEL_PATTERN,
      signIn: SIGN_IN_LABEL_PATTERN,
      challenge: CHALLENGE_LABEL_PATTERN,
    }
  }

  /**
   * Refuse to touch a browser whose live DevTools identity is not the exact
   * owned one. Every page read names that identity, and it is re-checked before
   * and after each evaluation, so a replaced listener on the port is never read.
   * @param browser - the attached puppeteer browser.
   * @param expectedWebSocket - the identity the caller verified with the launcher.
   * @throws {Error} after detaching, when the identity is missing or different.
   */
  async #assertIdentity(browser, expectedWebSocket) {
    if (typeof expectedWebSocket !== 'string' || expectedWebSocket.trim() === '') {
      await this.disconnect()
      throw new Error('缺少专用浏览器身份，拒绝访问页面。请先在面板里连接专用浏览器。')
    }
    if (browser.connected !== true || browser.wsEndpoint() !== expectedWebSocket) {
      await this.disconnect()
      throw new Error('浏览器连接身份与专用浏览器不一致；拒绝访问页面。')
    }
  }

  /** One bounded page evaluation in the tab's main world. */
  async #evaluate(page, fn, args, label, assertIdentity) {
    await assertIdentity?.()
    await this.#assertOrigin(page)
    await assertIdentity?.()
    // Guard in the same main-world task as the operation, closing the gap
    // between the CDP URL check and a navigation to a different origin.
    const script = '(() => { const guard = () => { const u = new URL(location.href); if (u.protocol !== "https:" || u.port || u.username || u.password || !' + JSON.stringify(this.#hosts) + '.includes(u.hostname)) throw new Error("untrusted page origin"); }; guard(); const result = (' + fn.toString() + ')(' + (JSON.stringify(args) ?? 'undefined') + '); guard(); return result; })()'
    const result = await withDeadline(page.evaluate(script), this.#readTimeoutMs, label)
    await assertIdentity?.()
    await this.#assertOrigin(page)
    await assertIdentity?.()
    if (result?.url !== undefined && !isChatGptTarget({ url: result.url }, this.#hosts)) throw new Error('untrusted read-back origin')
    return result
  }

  async #assertOrigin(page) {
    const info = await this.#targetInfoOf(page)
    if (info === undefined || !isChatGptTarget({ url: info.url }, this.#hosts)) throw new Error('the current CDP target is not on a trusted HTTPS origin')
  }

  /** Read failures propagate; an empty fallback is not proof of success. */
  async #safeFacts(page, sources) {
    return await this.#evaluate(page, readFacts, sources, 'cdp readFacts')
  }

  /** Poll one read until a predicate holds or the deadline expires. */
  async #poll(page, sources, ok, ms, label, navigation = false) {
    const deadline = Date.now() + ms
    let lastFacts
    for (;;) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        if (lastFacts !== undefined) return lastFacts
        throw new Error(`${label}: read-back deadline exceeded`)
      }
      try {
        const facts = await withDeadline(this.#safeFacts(page, sources), remaining, label)
        lastFacts = facts
        if (facts !== NO_FACTS && ok(facts)) return facts
        if (Date.now() >= deadline) return facts
      } catch (error) {
        // Only navigation readback may retry document replacement. Each new
        // read still runs both origin guards; other failures remain fatal.
        if (!navigation || !/Execution context was destroyed|Cannot find context with specified id/u.test(error instanceof Error ? error.message : String(error))) throw error
        if (Date.now() >= deadline) throw error
      }
      await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())))
    }
  }

  /** Explicitly open the model menu and return the read made while it is open. */
  async #openMenu(page, sources) {
    const before = await this.#safeFacts(page, sources)
    if (before.menu.open) return { facts: before }
    const clicked = await this.#evaluate(page, clickModelButton, sources, 'cdp clickModelButton')
    if (clicked !== true) throw new Error('chatgpt-composer: no composer model control matched the label pattern in this tab, so its menu cannot be read')
    const facts = await this.#poll(page, sources, (row) => row.menu.open === true, MENU_WAIT_MS, 'cdp open model menu')
    if (facts.menu.open !== true) throw new Error(`chatgpt-composer: the model menu did not open within ${String(MENU_WAIT_MS)}ms`)
    return { facts }
  }

  /** Close the model menu with Escape and verify it closed. */
  async #closeMenu(page, sources) {
    let facts = await this.#safeFacts(page, sources)
    if (!facts.menu.open) return { facts, closed: true }
    try {
      await this.#assertOrigin(page)
      await withDeadline(page.keyboard.press('Escape'), PROTOCOL_TIMEOUT_MS, 'cdp Escape')
    } catch (error) {
      this.#logger?.warn?.('chatgpt-composer: Escape via the protocol failed: %o', error)
    }
    facts = await this.#poll(page, sources, (row) => row.menu.open !== true, MENU_WAIT_MS, 'cdp close model menu')
    if (facts.menu.open !== true) return { facts, closed: true }
    try {
      await this.#evaluate(page, syntheticEscape, undefined, 'cdp synthetic Escape')
    } catch {
      // The synthetic key is a fallback; the poll below decides the verdict.
    }
    facts = await this.#poll(page, sources, (row) => row.menu.open !== true, MENU_WAIT_MS, 'cdp close model menu')
    return { facts, closed: facts.menu.open !== true }
  }

  /**
   * The current CDP identity and URL, never cached across navigation. `Target.getTargetInfo`
   * is authoritative: a page that is still loading can report an empty
   * `page.url()` even though the target already has its URL.
   */
  async #targetInfoOf(page, strict = false) {
    try {
      const session = await withDeadline(page.createCDPSession(), this.#connectTimeoutMs, 'cdp createCDPSession')
      try {
        const { targetInfo } = await withDeadline(session.send('Target.getTargetInfo'), this.#connectTimeoutMs, 'cdp Target.getTargetInfo')
        const id = targetInfo?.targetId
        if (typeof id === 'string' && id !== '') {
          const info = { id, url: typeof targetInfo.url === 'string' ? targetInfo.url : '' }
          return info
        }
      } finally {
        await session.detach().catch(() => undefined)
      }
    } catch (error) {
      this.#logger?.warn?.('chatgpt-composer: could not read a target identity: %o', error)
      if (strict) throw error
    }
    return undefined
  }

  /**
   * Resolve one ChatGPT page, by exact CDP target id whenever the caller named
   * one, and only after the live connection identity matched the owned browser.
   * A named id that is absent, or that belongs to a non-ChatGPT tab, is an
   * error: the sidebar's contents are never treated as proof of the target.
   * @param targetId - requested target id, or undefined for the first ChatGPT tab.
   * @param expectedWebSocket - exact identity of the plugin-owned browser.
   * @returns the page and its resolved target id.
   * @throws {Error} when the identity, the endpoint or the tab does not match.
   */
  async #page(targetId, expectedWebSocket) {
    if (typeof expectedWebSocket !== 'string' || expectedWebSocket.trim() === '') {
      await this.disconnect()
      throw new Error('缺少专用浏览器身份，拒绝访问页面。请先在面板里连接专用浏览器。')
    }
    const browser = await this.#connect()
    await this.#assertIdentity(browser, expectedWebSocket)
    const pages = await this.#chatPages(browser)
    await this.#assertIdentity(browser, expectedWebSocket)
    const rows = []
    for (const page of pages) {
      const info = await this.#targetInfoOf(page)
      if (info !== undefined) rows.push({ page, id: info.id, url: info.url !== '' ? info.url : page.url() })
    }
    await this.#assertIdentity(browser, expectedWebSocket)
    if (typeof targetId === 'string' && targetId !== '') {
      const found = rows.find((row) => row.id === targetId)
      if (found === undefined) throw new Error(`chatgpt-composer: no open CDP target has id ${targetId}; it was closed or replaced, so the bound tab cannot be read`)
      if (!isChatGptTarget({ type: 'page', url: found.url }, this.#hosts)) {
        throw new Error(`chatgpt-composer: target ${targetId} is not a ChatGPT page (${found.url})`)
      }
      return { page: found.page, targetId: found.id }
    }
    const fallback = rows.filter((row) => row.page !== this.#readerPage && row.page !== this.#historyPage && isChatGptTarget({ type: 'page', url: row.url }, this.#hosts))
    if (fallback.length === 0) throw new Error('没有打开的 ChatGPT 页面，请点击连接。')
    return { page: fallback[0].page, targetId: fallback[0].id }
  }

  /** One JSON GET against the DevTools HTTP endpoint. */
  async #getJson(url) {
    const response = await fetch(url, { method: 'GET' })
    if (!response.ok) throw new Error(`cdp GET ${url} -> ${String(response.status)}`)
    return await response.json()
  }

  /** Memoize one `puppeteer.connect` attachment to the running browser. */
  async #connect(timeoutMs = this.#connectTimeoutMs) {
    if (this.#browser !== undefined && this.#browser.connected === true) return this.#browser
    if (this.#connecting === undefined) {
      this.#connecting = (async () => {
        const puppeteer = await this.#loadPuppeteer()
        const browser = await withDeadline(
          puppeteer.connect({
            browserURL: this.#cdpUrl.base,
            defaultViewport: null,
            // Bound a page-side evaluation the way this side is bounded, so a
            // stalled renderer rejects instead of hanging the host process.
            protocolTimeout: Math.max(30000, this.#readTimeoutMs, timeoutMs),
          }),
          timeoutMs,
          `cdp connect ${this.#cdpUrl.base}`,
        )
        browser.once?.('disconnected', () => {
          if (this.#browser === browser) { this.#browser = undefined; this.#accountRevision++ }
        })
        this.#browser = browser
        return browser
      })().finally(() => {
        this.#connecting = undefined
      })
    }
    return await this.#connecting
  }
}

/**
 * Compile one configured label matcher.
 * @param value - the configured pattern source.
 * @param subject - field name for the diagnostic.
 * @returns the compiled regular expression.
 * @throws {Error} when the pattern is not a valid expression.
 */
function compile(value, subject) {
  try {
    return new RegExp(String(value), 'iu')
  } catch (error) {
    throw new Error(`chatgpt-composer: ${subject} is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`)
  }
}
