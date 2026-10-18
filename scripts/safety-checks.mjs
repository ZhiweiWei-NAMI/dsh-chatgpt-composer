import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Narrow regression counterexamples; actual service/CDP code, no real browser. */
export async function safetyChecks({ host, cdp, contract, read, expect, expectRejects, checkDir, store }) {
  const require = createRequire(import.meta.url)
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
  let facts = read()
  let failure = null
  let stalled = false
  let rechecks = 0
  const adapter = {
    cdpUrl: 'http://127.0.0.1:9',
    async disconnect() {},
    async readState() { return structuredClone(facts) },
    async recheck() { rechecks++; if (stalled) return new Promise(() => {}); if (failure === 'offline') throw Error('offline'); return structuredClone(facts) },
    async selectModel() {
      if (failure === 'selectModel') throw Error('partial model action failed')
      return { targetId: 'target-1', selected: true, readBack: true, checkedModel: { text: 'GPT-6', index: 0 }, composerTextAfter: '思考强度Pro' }
    },
    async selectChat() { if (failure === 'selectChat') throw Error('partial navigation failed'); facts = read({ chatId: 'xyz', url: 'https://chatgpt.com/c/xyz' }); return { targetId: 'target-1', verified: true } },
    async newChat() { if (failure === 'newChat') throw Error('partial newChat failed'); facts = read({ chatId: null, url: 'https://chatgpt.com/' }); return { targetId: 'target-1', verified: true } },
  }
  function service() {
    const ctx = new Context()
    ctx.provide('logger', { info() {}, warn() {} })
    return new host.ChatGptComposerService(ctx, { readTimeoutMs: 30, toolName: 'chatgpt_target' }, { adapter, preStepEnabled: true })
  }
  const input = { sessionId: 's', targetId: 'target-1', targetKind: 'existing', chatId: 'abc', modelName: 'GPT-6' }
  async function arm(s) { failure = null; facts = read(); await s.selectModel(input); return await s.bind(input) }
  const s = service()
  await arm(s)
  for (const action of ['selectChat', 'newChat', 'selectModel']) {
    await arm(s)
    failure = action
    await expectRejects(`safety: ${action} exception propagates`, () => s[action](input))
    failure = null
    await s.recheck('s')
    const status = await s.status({ sessionId: 's' })
    expect(`safety: ${action} failure retains abc but recheck cannot rearm`, status.binding.target.chatId === 'abc' && status.binding.stale && !status.injectionArmed)
  }
  await arm(s)
  facts = read({ chatId: 'xyz', url: 'https://chatgpt.com/c/xyz' })
  await s.selectModel(input)
  expect('safety: model-only success on xyz never rearms old abc', !(await s.status({ sessionId: 's' })).injectionArmed && s.bindingOf('s').target.chatId === 'abc')
  await expectRejects('safety: full bind rejects requested abc when actually xyz', () => s.bind(input))
  await arm(s)
  await s.selectChat(input)
  await expectRejects('safety: navigation success cannot reuse previous model selection', () => s.bind({ ...input, chatId: 'xyz' }))
  expect('safety: navigation success retains stale old reference', s.bindingOf('s').target.chatId === 'abc' && s.bindingOf('s').stale)
  for (const changed of [
    read({ url: 'https://example.com/c/abc' }), read({ url: 'http://chatgpt.com/c/abc' }),
    read({ url: 'https://chatgpt.com/c/xyz' }), read({ account: null }),
  ]) expect('safety: untrusted URL/path disagreement/missing account rejects', host.liveProblems(s.bindingOf('s'), changed).length > 0)
  expect('safety: /g/custom with chatId null is not a new draft', host.targetProblems(read({ url: 'https://chatgpt.com/g/custom', chatId: null }), { targetKind: 'new' }).length > 0)
  await arm(s)
  const listeners = []
  host.registerPreStep({ on: (_event, listener) => listeners.push(listener), logger: { warn() {} } }, s)
  const next = async () => ({ kind: 'continue', messages: [] })
  const payload = { agent: { session: { id: 's' } } }
  const before = rechecks
  const observed = await listeners[0](payload, next)
  expect('safety: pre-step performs live recheck before snapshot', observed.messages.length === 1 && rechecks === before + 1)
  expect('safety: same-strength model drift cannot be claimed live verified', observed.messages[0].content[0].text.includes('current model identity cannot be confirmed') && s.bindingOf('s').verification.model === 'selection-only')
  failure = 'offline'
  const offline = await listeners[0](payload, next)
  expect('safety: offline browser causes no pre-step injection', offline.messages.length === 0 && s.bindingOf('s').stale)
  await arm(s)
  stalled = true
  const start = Date.now()
  const timeout = await listeners[0](payload, next)
  expect('safety: hanging recheck fails closed within total deadline', timeout.messages.length === 0 && s.bindingOf('s').stale && Date.now() - start < 1000)
  stalled = false
  // One stalled queue remains intentionally unresolved; no transport or process was started.

  // Actual CdpAdapter, with only its public puppeteer dependency replaced.
  const mockPath = join(checkDir, 'puppeteer-safety.mjs')
  writeFileSync(mockPath, `export const connect = async () => globalThis.__composerSafetyBrowser`)
  const modelButton = { textContent: '思考强度Pro', getAttribute: key => key === 'aria-label' ? '选择 ChatGPT 模型' : key === 'aria-haspopup' ? 'menu' : null }
  const accountButton = { textContent: 'F', getAttribute: key => key === 'aria-label' ? '打开个人资料菜单' : null }
  let menuOpen = false
  let radios = []
  let clickedNames = []
  let beforeRadioClick = () => {}
  modelButton.click = () => { menuOpen = true }
  const makeRadio = (name, disabled = false) => ({
    textContent: name, disabled, checked: name === 'GPT-6',
    hasAttribute: key => key === 'disabled' && disabled,
    getAttribute(key) { return key === 'aria-checked' ? String(this.checked) : key === 'aria-disabled' ? String(disabled) : null },
    click() { clickedNames.push(name); for (const radio of radios) radio.checked = radio === this; menuOpen = false },
  })
  const document = {
    title: 'mock',
    querySelectorAll(selector) { if (selector === 'button,[role="button"]') return [modelButton]; if (selector === 'button,a,[role="button"]') return [accountButton]; return [] },
    querySelector(selector) {
      if (selector === '[contenteditable="true"]') return { textContent: '' }
      if (selector === '[role="menu"]' && menuOpen) return { querySelectorAll: selector => selector === '[role="menuitemradio"]' ? radios : [] }
      return null
    },
  }
  let url = 'https://chatgpt.com/c/abc'
  let evaluated = 0
  let navigate = 0
  let race = false
  let navigationRace = false
  let navigationGuards = 0
  let destroyContext = false
  const { runInNewContext } = await import('node:vm')
  const page = {
    url: () => url,
    keyboard: { async press() { menuOpen = false } },
    async createCDPSession() {
      if (navigationRace && ++navigationGuards === 3) url = 'https://example.com/'
      return { async send(method, args) { if (method === 'Page.navigate') { navigate++; url = args.url; return {} } return { targetInfo: { targetId: 'target-1', url } } }, async detach() {} }
    },
    async evaluate(script) {
      evaluated++
      if (race || navigationRace && script.includes('function assignLocation')) url = 'https://example.com/'
      if (script.includes('function clickRadio')) beforeRadioClick()
      const location = new URL(url)
      location.assign = destination => { navigate++; url = destination }
      const result = runInNewContext(script, { location, document, URL })
      if (navigationRace && script.includes('function clickChatLink')) navigationGuards = 0
      if (destroyContext && script.includes('function assignLocation')) throw Error('Execution context was destroyed, most likely because of a navigation.')
      return result
    },
  }
  globalThis.__composerSafetyBrowser = { connected: true, async pages() { return [page] }, once() {}, disconnect() {} }
  const previous = process.env[cdp.PUPPETEER_ENV]
  process.env[cdp.PUPPETEER_ENV] = mockPath
  const real = new cdp.CdpAdapter({ logger: { warn() {} } })
  try {
    const readState = await real.readState({ targetId: 'target-1' })
    const actual = { ...readState, generatedAt: new Date().toISOString() }
    expect('safety: actual adapter readState codec accepts JSON roundtrip without patched fields', contract.ENDPOINT_SPECS.readState.result.create().safeParse(JSON.parse(JSON.stringify(actual))).success && !('patterns' in actual) && typeof actual.labelPatterns.model === 'string')
    url = 'https://example.com/c/abc'
    const priorEvaluations = evaluated
    await expectRejects('safety: same targetId navigated to example is rejected', () => real.recheck({ targetId: 'target-1' }))
    expect('safety: foreign origin is not evaluated using cached URL', evaluated === priorEvaluations)
    url = 'https://chatgpt.com/g/custom'
    const draft = await real.newChat({ targetId: 'target-1' })
    expect('safety: /g/custom actually navigates to canonical root before draft success', navigate === 1 && draft.verified && draft.url === 'https://chatgpt.com/')
    race = true
    await expectRejects('safety: origin changed between CDP and evaluation is rejected in-page', () => real.readState({ targetId: 'target-1' }))
    race = false

    // Regression 1: swap the target in the old check/session gap, never navigate it back.
    url = 'https://chatgpt.com/c/abc'
    navigationRace = true
    navigationGuards = -1000
    const priorNavigations = navigate
    let rejectedForeign = false
    try { await real.selectChat({ targetId: 'target-1', chatId: 'xyz' }) } catch (error) { rejectedForeign = /trusted|untrusted/u.test(error.message) }
    const foreignUntouched = rejectedForeign && url === 'https://example.com/' && navigate === priorNavigations
    navigationRace = false
    url = 'https://chatgpt.com/c/abc'
    destroyContext = true
    const afterDestroyed = await real.selectChat({ targetId: 'target-1', chatId: 'xyz' })
    destroyContext = false
    expect('regression: navigation gap rejects foreign target; context destruction requires exact readback', foreignUntouched && afterDestroyed.verified && afterDestroyed.url === 'https://chatgpt.com/c/xyz')

    // Regression 2: stale caller index and a second reorder at click time.
    const request = { targetId: 'target-1', modelIndex: 0, modelName: 'GPT-5.6 Sol' }
    radios = [makeRadio('GPT-6'), makeRadio('GPT-5.6 Sol')]
    beforeRadioClick = () => { radios.reverse() }
    const selected = await real.selectModel(request)
    let modelSafe = selected.selected && selected.readBack && selected.requested.index === 0 && selected.requested.name === request.modelName && clickedNames.join() === request.modelName
    for (const replacement of [
      () => [makeRadio('GPT-6')],
      () => [makeRadio('GPT-5.6 Sol'), makeRadio('GPT-5.6 Sol')],
      () => [makeRadio('GPT-5.6 Sol', true)],
    ]) {
      radios = [makeRadio('GPT-6'), makeRadio('GPT-5.6 Sol')]
      const count = clickedNames.length
      beforeRadioClick = () => { radios = replacement() }
      const refused = await real.selectModel(request)
      modelSafe &&= !refused.selected && !refused.readBack && clickedNames.length === count && refused.requested.index === 0 && refused.requested.name === request.modelName
    }
    expect('regression: exact unique enabled model at click time; original index/name preserved', modelSafe)
  } finally {
    await real.disconnect()
    delete globalThis.__composerSafetyBrowser
    if (previous === undefined) delete process.env[cdp.PUPPETEER_ENV]; else process.env[cdp.PUPPETEER_ENV] = previous
  }

  // Exercise the actual client store failure path; no DOM or live RPC.
  const historical = { bound: true, binding: { target: { targetId: 'target-1' }, stale: true }, injectionArmed: false }
  store.ctx = { get: () => ({ selectModel: async () => ({ ok: false, error: { message: 'partial selection failed' } }), status: async () => ({ ok: true, value: historical }) }) }
  store.patchDraft({ targetId: 'target-1' })
  await store.selectModel({ index: 0, text: 'GPT-6' })
  expect('safety: UI failure refreshes retained stale binding and stops armed indicator', store.state.status === historical && !store.state.busy && store.state.error === 'partial selection failed')
}
