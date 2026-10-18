/**
 * CDP adapter for a browser the user already runs.
 *
 * Attaches to a Chromium DevTools endpoint (`http://127.0.0.1:9222` by default),
 * never launches a browser and never calls `browser.close()` — only
 * `disconnect()`.
 *
 * Allowed interactions, and the only ones implemented:
 * - read what a ChatGPT tab already rendered (sidebar links, the conversation id
 *   in the URL, the composer model control, the profile label);
 * - a page-context click on a control the caller explicitly asked for: the model
 *   button (open menu), one model radio (select), the sidebar chat link, the home
 *   entry;
 * - Escape to close the model menu;
 * - guarded main-world `location.assign` to a chat the caller named, or to the ChatGPT
 *   root, when the rendered entry is absent.
 *
 * Everything runs in the page's main world through `page.evaluate`, never
 * through `page.$`/`ElementHandle`: on a hidden tab the element-handle path was
 * measured hanging in `Runtime.callFunctionOn` until puppeteer's 180s protocol
 * budget expired, while main-world evaluation answered in milliseconds. The
 * connection therefore sets `protocolTimeout` to a bounded 10s and every wait
 * below is bounded by a deadline.
 *
 * Never: cookies, storage, tokens, `Network.getAllCookies`, page-context
 * `fetch` to ChatGPT's JSON endpoints, typing, or sending a message.
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

/** Bounded puppeteer protocol budget; see the module header for the measurement. */
const PROTOCOL_TIMEOUT_MS = 10_000

/** Bounded wait for the model menu to open or close. */
const MENU_WAIT_MS = 4_000

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
    chatId: /^\/c\/([^/?#]+)/u.exec(location.pathname)?.[1] ?? null,
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
 * Click one model radio of the open menu in the tab's main world.
 * @param name - exact collapsed label, resolved again at click time.
 * @returns whether a unique enabled radio was found and clicked.
 */
function clickRadio(name) {
  const menu = document.querySelector('[role="menu"]')
  const matches = menu === null ? [] : [...menu.querySelectorAll('[role="menuitemradio"]')].filter(
    (element) => String(element.textContent ?? '').replace(/\s+/gu, ' ').trim() === name,
  )
  if (matches.length !== 1) return false
  const radio = matches[0]
  if (radio.disabled === true || radio.hasAttribute('disabled') || radio.getAttribute('aria-disabled') === 'true') return false
  radio.click()
  return true
}

/** Destination validation and assignment run synchronously inside #evaluate's origin guards. */
function assignLocation({ url, hosts }) {
  const destination = new URL(url)
  if (destination.protocol !== 'https:' || destination.port || destination.username || destination.password || !hosts.includes(destination.hostname)) throw new Error('untrusted navigation destination')
  location.assign(destination.href)
}

/**
 * Click the rendered home entry (the ChatGPT root link) in the tab's main world.
 * @returns whether the entry existed and was clicked.
 */
function clickHomeEntry() {
  const entry = document.querySelector('a[href="/"]')
  if (entry === null) return false
  entry.click()
  return true
}

/**
 * Click the sidebar link of one conversation in the tab's main world.
 * @param chatId - conversation id to navigate to.
 * @returns whether the link existed and was clicked.
 */
function clickChatLink(chatId) {
  const link = [...document.querySelectorAll('a[href^="/c/"]')].find(
    (anchor) => (anchor.getAttribute('href') ?? '').replace(/^\/c\/([^/?#]+).*$/u, '$1') === chatId,
  )
  if (link === undefined) return false
  link.click()
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

function normalizeLabel(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().toLocaleLowerCase()
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
  const match = /^\/c\/([^/?#]+)/u.exec(pathname)
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
   * @returns browser facts plus the ChatGPT page tabs currently open.
   */
  async probe() {
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
  async readState({ targetId } = {}) {
    const generation = ++this.#generation
    const { page, targetId: resolved } = await this.#page(targetId)
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
  async readModelMenu({ targetId } = {}) {
    const { page, targetId: resolved } = await this.#page(targetId)
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
   * Explicitly select one model radio, then reopen the menu and read
   * `aria-checked` back for the option that was requested.
   * @param options - the tab, and the option named by index or by label.
   * @returns the requested option and the checked read-back.
   */
  async selectModel({ targetId, modelIndex, modelName } = {}) {
    const { page, targetId: resolved } = await this.#page(targetId)
    const sources = this.#sources()
    const notes = []
    const opened = await this.#openMenu(page, sources)
    const models = opened.facts.menu.models
    const composerTextBefore = opened.facts.modelButton?.composerText ?? ''
    const modelControlLabel = opened.facts.modelButton?.controlLabel ?? null
    const strength = opened.facts.strength ?? null
    const requested = { index: Number.isInteger(modelIndex) ? modelIndex : null, name: typeof modelName === 'string' && modelName !== '' ? modelName : null }
    // A supplied name is authoritative even when the caller's index is stale.
    const matches = requested.name !== null
      ? models.filter((model) => model.text === requested.name)
      : models.filter((model) => model.index === requested.index)
    const wanted = matches.length === 1 && models.filter((model) => model.text === matches[0].text).length === 1 ? matches[0] : undefined
    if (wanted === undefined) {
      notes.push(`selection: no model radio matched ${JSON.stringify(requested)} among ${JSON.stringify(models.map((model) => model.text))}; nothing was clicked`)
      const closed = await this.#closeMenu(page, sources)
      return {
        targetId: resolved,
        selected: false,
        requested,
        checkedModel: uniqueCheckedModel(models),
        readBack: false,
        modelControlLabel,
        strength,
        composerTextBefore,
        composerTextAfter: closed.facts.modelButton?.composerText ?? composerTextBefore,
        notes,
        readAt: new Date().toISOString(),
      }
    }
    const clicked = await this.#evaluate(page, clickRadio, wanted.text, 'cdp clickRadio')
    if (clicked !== true) {
      notes.push('selection: the model radio disappeared before it could be clicked; nothing was selected')
      await this.#closeMenu(page, sources)
      return {
        targetId: resolved,
        selected: false,
        requested,
        checkedModel: null,
        readBack: false,
        modelControlLabel,
        strength,
        composerTextBefore,
        composerTextAfter: composerTextBefore,
        notes,
        readAt: new Date().toISOString(),
      }
    }
    // Radix closes the menu on selection, so the checked read-back reopens it.
    await this.#poll(page, sources, (row) => row.menu.open !== true, MENU_WAIT_MS, 'cdp menu closes after selection')
    let checkedModel = null
    try {
      const second = await this.#openMenu(page, sources)
      checkedModel = uniqueCheckedModel(second.facts.menu.models)
      if (checkedModel === null) notes.push('read-back: the reopened menu reports no checked model radio')
    } catch (error) {
      notes.push(`read-back: the menu could not be reopened (${error instanceof Error ? error.message : String(error)})`)
    }
    const closed = await this.#closeMenu(page, sources)
    const readBack = closed.closed === true && checkedModel !== null && checkedModel.text === wanted.text
    if (!readBack) notes.push(`read-back: the checked option is ${checkedModel === null ? 'unknown' : JSON.stringify(checkedModel.text)}, not ${JSON.stringify(wanted.text)}`)
    else notes.push(`read-back: ${JSON.stringify(checkedModel.text)} reports aria-checked=true after the selection`)
    return {
      targetId: resolved,
      selected: true,
      requested,
      checkedModel,
      readBack,
      modelControlLabel,
      strength,
      composerTextBefore,
      composerTextAfter: closed.facts.modelButton?.composerText ?? composerTextBefore,
      notes,
      readAt: new Date().toISOString(),
    }
  }

  /**
   * Explicitly navigate one tab to an existing chat, then read the active
   * conversation id and two target/account fingerprints back.
   * @param options - the tab and the conversation to navigate to.
   * @returns the navigation read-back.
   */
  async selectChat({ targetId, chatId } = {}) {
    if (typeof chatId !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(chatId)) throw new Error('invalid chatId')
    const { page, targetId: resolved } = await this.#page(targetId)
    const sources = this.#sources()
    const notes = []
    const before = await this.#safeFacts(page, sources)
    const beforeFingerprint = fingerprintOf(before, resolved)
    let route = 'already active'
    if (before.chatId !== chatId) {
      const clicked = await this.#evaluate(page, clickChatLink, chatId, 'cdp clickChatLink')
      route = clicked === true ? 'sidebar link' : 'url navigation'
      if (clicked !== true) {
        await this.#navigate(page, `${originOf(before.url) ?? 'https://chatgpt.com'}/c/${chatId}`)
      }
      const waited = await this.#poll(page, sources, (row) => row.chatId === chatId, this.#readTimeoutMs, 'cdp selectChat', true)
      if (waited === undefined || waited.chatId !== chatId) notes.push(`navigation: the tab did not reach /c/${chatId} within the bounded wait`)
    }
    const after = await this.#safeFacts(page, sources)
    const afterFingerprint = fingerprintOf(after, resolved)
    const accountsAgree = beforeFingerprint.accountLabel === afterFingerprint.accountLabel && beforeFingerprint.accountInitial === afterFingerprint.accountInitial
    const targetsAgree = beforeFingerprint.targetId !== '' && beforeFingerprint.targetId === afterFingerprint.targetId
    if (!targetsAgree) notes.push('fingerprint: the CDP target id is not identical across the navigation')
    if (!accountsAgree) notes.push('fingerprint: the account label/initial changed across the navigation; the target was not verified')
    const verified = new URL(after.url).pathname === `/c/${chatId}` && after.chatId === chatId && targetsAgree && accountsAgree
    notes.push(`route: ${route}`)
    return {
      targetId: resolved,
      chatId,
      verified,
      title: after.title,
      url: after.url,
      fingerprints: { before: beforeFingerprint, after: afterFingerprint },
      notes,
      readAt: new Date().toISOString(),
    }
  }

  /**
   * Explicitly navigate one tab to the ChatGPT root and verify a draft: no
   * conversation id in the URL, an empty composer, and unchanged fingerprints.
   * Never types and never sends.
   * @param options - the tab to act on.
   * @returns the navigation read-back.
   */
  async newChat({ targetId } = {}) {
    const { page, targetId: resolved } = await this.#page(targetId)
    const sources = this.#sources()
    const notes = []
    const before = await this.#safeFacts(page, sources)
    const beforeFingerprint = fingerprintOf(before, resolved)
    let route = 'already at the root'
    if (before.url !== 'https://chatgpt.com/' || before.composer.found !== true || before.composer.empty !== true) {
      // Prefer the rendered SPA entry to avoid destroying the document and
      // reloading account/avatar state; exact canonical-root readback is unchanged.
      const clicked = await this.#evaluate(page, clickHomeEntry, undefined, 'cdp clickHomeEntry')
      route = clicked === true ? 'home entry' : 'url navigation'
      if (clicked !== true) await this.#navigate(page, 'https://chatgpt.com/')
      const waited = await this.#poll(page, sources, (row) => row.url === 'https://chatgpt.com/' && row.chatId === null && row.composer.found && row.composer.empty && (row.account?.label ?? null) === beforeFingerprint.accountLabel && (row.account?.initial ?? null) === beforeFingerprint.accountInitial, this.#readTimeoutMs, 'cdp newChat', true)
      if (waited?.url !== 'https://chatgpt.com/') notes.push('navigation: the tab did not reach the ChatGPT root within the bounded wait')
    }
    const after = await this.#safeFacts(page, sources)
    const afterFingerprint = fingerprintOf(after, resolved)
    const accountsAgree = beforeFingerprint.accountLabel === afterFingerprint.accountLabel && beforeFingerprint.accountInitial === afterFingerprint.accountInitial
    const targetsAgree = beforeFingerprint.targetId !== '' && beforeFingerprint.targetId === afterFingerprint.targetId
    if (!targetsAgree) notes.push('fingerprint: the CDP target id is not identical across the navigation')
    if (!accountsAgree) notes.push('fingerprint: the account label/initial changed across the navigation; the target was not verified')
    if (!after.composer.found) notes.push('draft: no composer element was rendered, so the draft could not be read')
    else if (!after.composer.empty) notes.push('draft: the composer is not empty; this plugin never types, so the text was already there')
    notes.push(`route: ${route}`)
    const verified = after.url === 'https://chatgpt.com/' && after.chatId === null && after.composer.found === true && after.composer.empty === true && targetsAgree && accountsAgree
    return {
      targetId: resolved,
      verified,
      url: after.url,
      chatId: after.chatId,
      composerFound: after.composer.found,
      draftEmpty: after.composer.empty,
      fingerprints: { before: beforeFingerprint, after: afterFingerprint },
      notes,
      readAt: new Date().toISOString(),
    }
  }

  /**
   * Read the tab a binding pins, so the caller can decide whether the binding
   * still describes it. Pure read: no click, no navigation.
   * @param options - the pinned target id.
   * @returns the resolved target id and the tab's current facts.
   */
  async recheck({ targetId } = {}) {
    const generation = ++this.#generation
    const { page, targetId: resolved } = await this.#page(targetId)
    const facts = await this.#evaluate(page, readFacts, this.#sources(), 'cdp recheck')
    return { generation, cdpUrl: this.#cdpUrl.base, ...normalizeRead(facts, { model: this.#modelLabelPattern, account: this.#accountLabelPattern }, resolved) }
  }

  /**
   * Release the attachment. Only `disconnect()` runs; the browser keeps running
   * with all its tabs.
   * @returns completion of the detach.
   */
  async disconnect() {
    const browser = this.#browser
    this.#browser = undefined
    this.#connecting = undefined
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
    }
  }

  /** One bounded page evaluation in the tab's main world. */
  async #evaluate(page, fn, args, label) {
    await this.#assertOrigin(page)
    // Guard in the same main-world task as the operation, closing the gap
    // between the CDP URL check and a navigation to a different origin.
    const script = '(() => { const guard = () => { const u = new URL(location.href); if (u.protocol !== "https:" || u.port || u.username || u.password || !' + JSON.stringify(this.#hosts) + '.includes(u.hostname)) throw new Error("untrusted page origin"); }; guard(); const result = (' + fn.toString() + ')(' + (JSON.stringify(args) ?? 'undefined') + '); guard(); return result; })()'
    const result = await withDeadline(page.evaluate(script), this.#readTimeoutMs, label)
    await this.#assertOrigin(page)
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

  /** Guard and navigate in one main-world task; only the caller's exact read-back proves success. */
  async #navigate(page, url) {
    if (!isChatGptTarget({ url }, this.#hosts)) throw new Error('untrusted navigation destination')
    try {
      await this.#evaluate(page, assignLocation, { url, hosts: this.#hosts }, 'cdp location.assign')
    } catch (error) {
      // Navigation may destroy its own execution context. Never hide an origin
      // guard error (or any other failure), nor treat context destruction as success.
      if (!/Execution context was destroyed|Cannot find context with specified id/u.test(error instanceof Error ? error.message : String(error))) throw error
      await this.#assertOrigin(page)
    }
  }

  /**
   * The current CDP identity and URL, never cached across navigation. `Target.getTargetInfo`
   * is authoritative: a page that is still loading can report an empty
   * `page.url()` even though the target already has its URL.
   */
  async #targetInfoOf(page) {
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
    }
    return undefined
  }

  /**
   * Resolve one ChatGPT page, by exact CDP target id whenever the caller named
   * one. A named id that is absent, or that belongs to a non-ChatGPT tab, is an
   * error: the sidebar's contents are never treated as proof of the target.
   * @param targetId - requested target id, or undefined for the first ChatGPT tab.
   * @returns the page and its resolved target id.
   * @throws {Error} when the endpoint is down, the id is absent, or no ChatGPT tab is open.
   */
  async #page(targetId) {
    const browser = await this.#connect()
    const pages = await withDeadline(browser.pages(), this.#connectTimeoutMs, 'cdp browser.pages()')
    const rows = []
    for (const page of pages) {
      const info = await this.#targetInfoOf(page)
      if (info !== undefined) rows.push({ page, id: info.id, url: info.url !== '' ? info.url : page.url() })
    }
    if (typeof targetId === 'string' && targetId !== '') {
      const found = rows.find((row) => row.id === targetId)
      if (found === undefined) throw new Error(`chatgpt-composer: no open CDP target has id ${targetId}; it was closed or replaced, so the bound tab cannot be read`)
      if (!isChatGptTarget({ type: 'page', url: found.url }, this.#hosts)) {
        throw new Error(`chatgpt-composer: target ${targetId} is not a ChatGPT page (${found.url})`)
      }
      return { page: found.page, targetId: found.id }
    }
    const fallback = rows.find((row) => isChatGptTarget({ type: 'page', url: row.url }, this.#hosts))
    if (fallback === undefined) throw new Error('chatgpt-composer: no ChatGPT page tab is open in the attached browser; open one and retry')
    return { page: fallback.page, targetId: fallback.id }
  }

  /** One JSON GET against the DevTools HTTP endpoint. */
  async #getJson(url) {
    const response = await fetch(url, { method: 'GET' })
    if (!response.ok) throw new Error(`cdp GET ${url} -> ${String(response.status)}`)
    return await response.json()
  }

  /** Memoize one `puppeteer.connect` attachment to the running browser. */
  async #connect() {
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
            protocolTimeout: Math.min(PROTOCOL_TIMEOUT_MS, this.#readTimeoutMs),
          }),
          this.#connectTimeoutMs,
          `cdp connect ${this.#cdpUrl.base}`,
        )
        browser.once?.('disconnected', () => {
          if (this.#browser === browser) this.#browser = undefined
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

/** Origin of a URL, or undefined when it is not absolute. */
function originOf(raw) {
  try {
    return new URL(String(raw)).origin
  } catch {
    return undefined
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
