/**
 * Explicit Windows-only onboarding and the owned background-browser lifecycle.
 * No startup side effects, no profile copying, credential reads or kill-by-port.
 *
 * One persistent profile directory belongs to this plugin and exactly one
 * visible Chromium process may use it. This edition only ever starts the
 * **headed** background browser: after a verified sign-in the browser is
 * optionally minimized and keeps running, so the account stays connected while
 * the panel is closed. There is no headless mode or browser handoff.
 * Only host/context disposal closes owned browsers, after an
 * exact DevTools identity check. Foreign browsers are never adopted or closed.
 * A separate Node guardian also performs that check when the host pipe ends.
 *
 * Window operations require the exact launched DevTools websocket. On Windows,
 * the owned child's window is hidden from the taskbar after login and restored
 * only on explicit connect. HWND ownership is checked against that child PID;
 * no process is terminated and no unrelated port owner is touched.
 *
 * @module dsh-chatgpt-composer/browser-launcher
 */

import { spawn } from 'node:child_process'
import { access, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { dedicatedArgs, ownershipAllowed } from './account.js'

const REGISTRY = Symbol.for('dsh-chatgpt-composer.owned-browsers')
const registry = globalThis[REGISTRY] ??= new Map()

/** The one bounded /json/version read used for ownership identity. */
async function readVersionDefault(base) {
  const response = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(2500), redirect: 'error' })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  return await response.json()
}

/**
 * Close only an exact, freshly verified browser websocket. The child-exit or
 * endpoint read-back is authoritative: Browser.close may drop the socket before
 * returning a CDP reply (including a WebSocket error in some Node versions).
 * Kept self-contained so the independent guardian runs the identical policy.
 */
async function closeExactBrowser(endpoint, websocket, readVersion = readVersionDefault, exited = () => false) {
  try {
    const base = new URL(endpoint)
    const target = new URL(websocket)
    if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port || base.username || base.password || base.pathname !== '/' || base.search || base.hash ||
        target.protocol !== 'ws:' || target.hostname !== '127.0.0.1' || target.port !== base.port || target.username || target.password || target.search || target.hash || !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/u.test(target.pathname)) {
      return { closed: false, reason: '拒绝关闭：专用浏览器身份无效。' }
    }
    if (exited()) return { closed: true, reason: '' }
    const version = await readVersion(endpoint)
    if (version.webSocketDebuggerUrl !== websocket) return { closed: false, reason: '拒绝关闭：端口上的 websocket 与本插件启动身份不一致。' }
    if (typeof globalThis.WebSocket !== 'function') return { closed: false, reason: '当前 Node 运行时不提供 WebSocket，未关闭浏览器。' }
    let sent = false
    await new Promise((resolve) => {
      let socket
      let done = false
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        try { socket?.close() } catch { /* Browser.close can already have closed it */ }
        resolve()
      }
      const timer = setTimeout(finish, 2500)
      try {
        socket = new globalThis.WebSocket(websocket)
        socket.addEventListener('open', () => {
          if (done) return
          try { socket.send(JSON.stringify({ id: 1, method: 'Browser.close' })); sent = true } catch { finish() }
        }, { once: true })
        socket.addEventListener('message', event => {
          try { if (JSON.parse(String(event.data)).id === 1) finish() } catch { /* unrelated frame */ }
        })
        socket.addEventListener('close', finish, { once: true })
        socket.addEventListener('error', finish, { once: true })
      } catch { finish() }
    })
    if (!sent) return { closed: exited(), reason: '未能向已验证的浏览器发送 Browser.close。' }
    // A reply alone does not prove exit. Never reconnect or send to a replacement.
    for (let attempt = 0; attempt < 4; attempt++) {
      if (exited()) return { closed: true, reason: '' }
      try {
        const live = await readVersion(endpoint)
        if (live.webSocketDebuggerUrl !== websocket) return { closed: true, reason: '' }
      } catch { return { closed: true, reason: '' } }
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    return { closed: false, reason: '已发送 Browser.close，但原专用浏览器尚未确认退出。' }
  } catch (error) {
    return { closed: exited(), reason: `未关闭专用浏览器：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** Runs in a detached Node process, with no host imports, RPCs or PID operations. */
function guardianMain(startupTimeoutMs) {
  let owned = null
  let input = ''
  let ending = false
  const startupTimer = setTimeout(() => process.exit(0), startupTimeoutMs)
  const finish = async () => {
    if (ending) return
    ending = true
    clearTimeout(startupTimer)
    // Bound the entire orphan-cleanup attempt, including networking and sockets.
    const deadline = setTimeout(() => process.exit(1), 10000)
    try { if (owned) await closeExactBrowser(owned.endpoint, owned.websocket) }
    finally { clearTimeout(deadline); process.exit(0) }
  }
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    input += chunk
    if (input.length > 16384) { void finish(); return }
    let newline
    while ((newline = input.indexOf('\n')) !== -1) {
      const line = input.slice(0, newline)
      input = input.slice(newline + 1)
      let message
      try { message = JSON.parse(line) } catch { continue }
      if (message.type === 'arm' && !owned && typeof message.endpoint === 'string' && typeof message.websocket === 'string') {
        // Identity originates only from this launch's stderr. The final close
        // independently rechecks /json/version; an arbitrary port is never used.
        owned = { endpoint: message.endpoint, websocket: message.websocket }
        clearTimeout(startupTimer)
        process.stdout.write('armed\n')
      } else if (message.type === 'release') {
        clearTimeout(startupTimer)
        process.exit(0)
      }
    }
  })
  process.stdin.once('end', () => { void finish() })
  process.stdin.once('close', () => { void finish() })
  process.stdin.once('error', () => { void finish() })
  process.stdout.write('ready\n')
  process.stdin.resume()
}

/** Start the guardian before Chrome; fail closed if Node mode is unavailable. */
async function startGuardian(startTimeoutMs = 15000) {
  const startupTimeoutMs = Math.max(30000, Number.isFinite(startTimeoutMs) ? startTimeoutMs + 10000 : 30000)
  const source = `${readVersionDefault.toString()}\n${closeExactBrowser.toString()}\n(${guardianMain.toString()})(${startupTimeoutMs})`
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    shell: false, detached: true, windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  // A dead guardian must never cause an unhandled pipe error in the host.
  child.stdin.on('error', () => {})
  let alive = true
  let stopped = false
  child.once('exit', () => { alive = false })
  const send = message => {
    if (stopped || !alive || child.stdin.destroyed || !child.stdin.writable) throw new Error('专用浏览器生命周期守护进程已断开。')
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }
  try {
    await new Promise((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => finish(new Error('无法启动 Node 浏览器生命周期守护进程；未启动浏览器。')), 5000)
      const finish = error => {
        clearTimeout(timer)
        child.stdout.off('data', onData)
        child.off('error', onError)
        child.off('exit', onExit)
        if (error) reject(error); else resolve()
      }
      const onData = chunk => { output += String(chunk); if (output.includes('ready\n')) finish() }
      const onError = () => finish(new Error('无法启动 Node 浏览器生命周期守护进程；未启动浏览器。'))
      const onExit = () => finish(new Error('Node 浏览器生命周期守护进程提前退出；未启动浏览器。'))
      child.stdout.on('data', onData)
      child.once('error', onError)
      child.once('exit', onExit)
    })
  } catch (error) {
    child.stdin.destroy()
    child.stdout.destroy()
    child.unref()
    throw error
  }
  child.on('error', () => { alive = false })
  child.stdout.unref?.()
  child.stdin.unref?.()
  child.unref()
  return {
    async arm(endpoint, websocket) {
      await new Promise((resolve, reject) => {
        let output = ''
        let settled = false
        const timer = setTimeout(() => finish(new Error('浏览器生命周期守护进程未确认接收启动身份。')), 5000)
        const finish = error => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          child.stdout.off('data', onData)
          child.off('exit', onExit)
          child.off('error', onError)
          // No further guardian output is needed after the ownership ACK.
          child.stdout.destroy()
          if (error) reject(error); else resolve()
        }
        const onData = chunk => { output += String(chunk); if (output.includes('armed\n')) finish() }
        const onExit = () => finish(new Error('浏览器生命周期守护进程在确认身份前已退出。'))
        const onError = () => finish(new Error('浏览器生命周期守护进程无法确认启动身份。'))
        child.stdout.on('data', onData)
        child.once('exit', onExit)
        child.once('error', onError)
        try { send({ type: 'arm', endpoint, websocket }) } catch (error) { finish(error) }
      })
    },
    release() {
      if (stopped) return
      try { send({ type: 'release' }) } catch { /* already stopped */ }
      stopped = true
      child.stdin.end()
    },
    cleanup() { if (!stopped) { stopped = true; child.stdin.end() } },
    get alive() { return !stopped && alive && !child.stdin.destroyed },
  }
}

/** Hide/restore only the top-level window of our exact launched child. */
async function ownedWindow(pid, show, timeoutMs = 5000, handle) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('专用浏览器进程身份不可用。')
  if (handle !== undefined && (!Number.isSafeInteger(handle) || handle <= 0)) throw new Error('窗口身份不可用。')
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class DshOwnedWindow { [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int n); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); }'; $h = ${handle ? `[IntPtr]${handle}` : `(Get-Process -Id ${pid} -ErrorAction Stop).MainWindowHandle`}; if ($h -eq 0) { exit 2 }; [uint32]$owner = 0; [void][DshOwnedWindow]::GetWindowThreadProcessId($h, [ref]$owner); if ($owner -ne ${pid}) { exit 3 }; [void][DshOwnedWindow]::ShowWindowAsync($h, ${show ? 9 : 0}); for ($i = 0; $i -lt 10; $i++) { if ([DshOwnedWindow]::IsWindowVisible($h) -eq $${show ? 'true' : 'false'}) { Write-Output $h.ToInt64(); exit 0 }; Start-Sleep -Milliseconds 50 }; exit 4`
  return await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    let output = ''
    child.stdout.on('data', chunk => { output += String(chunk) })
    const timer = setTimeout(() => { child.kill(); reject(new Error('专用浏览器窗口操作超时。')) }, timeoutMs)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve(Number(output.trim())) : reject(new Error(`专用浏览器窗口操作失败 (${code})。`)) })
  })
}

/**
 * Best-effort minimize of one already-validated browser over its own DevTools
 * websocket, then hide its exact child-owned HWND from the taskbar. The browser,
 * its tabs, profile and login stay running. No port kill or browser close.
 * @param websocket - the exact `webSocketDebuggerUrl` this plugin launched.
 * @param timeoutMs - bounded budget for the whole exchange.
 * @returns true when the browser accepted the minimize request.
 * @throws {Error} with an actionable reason when it could not be minimized.
 */
async function minimizeDefault(websocket, timeoutMs = 5000, pid) {
  if (typeof globalThis.WebSocket !== 'function') throw new Error('当前 Node 运行时不提供 WebSocket，无法请求最小化；不会改用端口或 PID。')
  const socket = new globalThis.WebSocket(websocket)
  const pending = new Map()
  let nextId = 0
  let timer
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('专用浏览器没有在限时内响应最小化请求；未最小化，也不会关闭它。')), timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
  })
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => { resolve() }, { once: true })
    socket.addEventListener('error', () => { reject(new Error('无法连上本次启动输出的 DevTools websocket；拒绝改用其他方式最小化。')) }, { once: true })
  })
  socket.addEventListener('message', (event) => {
    let message
    try { message = JSON.parse(String(event.data)) } catch { return }
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    if (message.error !== undefined) entry.reject(new Error(`DevTools ${String(message.error.message ?? 'error')}`))
    else entry.resolve(message.result)
  })
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    try { socket.send(JSON.stringify({ id, method, params })) } catch (error) {
      pending.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
  try {
    await Promise.race([opened, expired])
    const targets = (await Promise.race([send('Target.getTargets', {}), expired]))?.targetInfos ?? []
    const page = targets.find((row) => row.type === 'page' && /^https:\/\/(?:chatgpt\.com|chat\.openai\.com|www\.chatgpt\.com)\//u.test(String(row.url ?? '')))
    if (page === undefined) throw new Error('专用浏览器里没有可最小化的 ChatGPT 页面；未最小化。')
    const window = await Promise.race([send('Browser.getWindowForTarget', { targetId: page.targetId }), expired])
    if (window === undefined || typeof window.windowId !== 'number') throw new Error('浏览器没有报告可最小化的窗口；未最小化。')
    await Promise.race([send('Browser.setWindowBounds', { windowId: window.windowId, bounds: { windowState: 'minimized' } }), expired])
    // Hide the owned window as well, so it does not occupy the taskbar.
    return await ownedWindow(pid, false, timeoutMs)
  } finally {
    clearTimeout(timer)
    try { socket.close() } catch { /* the browser may already have dropped it */ }
  }
}

/**
 * Validate the managed loopback endpoint.
 * @param value - the configured `cdpUrl`.
 * @returns the origin and port.
 * @throws {Error} when it is not a loopback `http://127.0.0.1:<1024-65535>` endpoint.
 */
export function managedEndpoint(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || !/^\d+$/u.test(url.port) || Number(url.port) < 1024 || Number(url.port) > 65535 || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('专用浏览器要求 cdpUrl 为 http://127.0.0.1:端口（1024–65535），请在插件配置中修改。')
  }
  return { url: url.origin, port: Number(url.port) }
}

async function portFree(port) {
  await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', () => reject(new Error(`端口 ${port} 已被其他进程占用；不会接管。请在卡片底部改用空闲端口并保存，或手动关闭占用端口的浏览器。`)))
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(resolve))
  })
}

async function discover(env) {
  const candidates = [
    env['PROGRAMFILES(X86)'] && join(env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    env.PROGRAMFILES && join(env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    env.PROGRAMFILES && join(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env['PROGRAMFILES(X86)'] && join(env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    try { await access(candidate); return candidate } catch { /* next installed location */ }
  }
  throw new Error('没有找到已安装的 Microsoft Edge 或 Google Chrome。请先安装其中一个浏览器，再点击重新打开。')
}

/** The test seams are injected by focused tests only, never Remote parameters. */
export class DedicatedBrowserLauncher {
  constructor(cdpUrl, options = {}) {
    this.cdpUrl = cdpUrl
    this.options = options
    const { port } = managedEndpoint(cdpUrl)
    this.profile = join(options.home ?? homedir(), '.dsh', 'chatgpt-composer', port === 9222 ? 'browser-data' : `browser-data-${port}`)
    this.registry = options.registry ?? registry
  }

  /** Bounded /json/version identity read. */
  async readVersion(base) {
    return await (this.options.readVersion ?? readVersionDefault)(base)
  }

  result(ready, state, mode, message) { return { ready, state, mode, cdpUrl: this.cdpUrl, message } }

  /**
   * Read ownership and CDP identity. Never launches, navigates or minimizes.
   * A listener this plugin did not start is reported as `unverified`, so a host
   * restart can never adopt an unknown browser.
   * @returns `{ ready, state, mode, cdpUrl, message }`.
   */
  async status() {
    const endpoint = managedEndpoint(this.cdpUrl)
    const state = this.registry.get(this.profile)
    const mode = state?.mode === 'headed' ? 'headed' : 'none'
    if (!state || state.endpoint !== endpoint.url || !state.websocket || state.exited) {
      const foreign = await this.foreignListener(endpoint)
      if (foreign !== null) return this.result(false, 'unverified', 'none', foreign)
      return this.result(false, 'not-running', 'none', '尚未启动专用浏览器。点击“连接 / 登录专用浏览器”，在 ChatGPT 网页登录后点“刷新”。')
    }
    try {
      const version = await this.readVersion(endpoint.url)
      if (version.webSocketDebuggerUrl !== state.websocket) {
        return this.result(false, 'unverified', mode, '端口上的浏览器身份已经变化；拒绝接管。请手动关闭该浏览器后重新连接。')
      }
      return this.result(true, 'headed-ready', 'headed', '专用后台浏览器已连接；登录状态仍须由渲染界面读回确认，并且与目标/模型绑定无关。')
    } catch {
      return this.result(false, 'disconnected', mode, '专用浏览器连接已断开。若已退出浏览器，请点击重新连接；登录可能需要重新完成。')
    }
  }

  /** Report — never adopt — a listener on the configured port that we did not start. */
  async foreignListener(endpoint) {
    try {
      const version = await this.readVersion(endpoint.url)
      return `端口 ${String(endpoint.port)} 上有一个不是本插件启动的浏览器（${String(version?.Browser ?? '未知')}）；不会接管、也不会关闭它。请在卡片底部改用空闲端口并保存，或手动关闭后重新连接。`
    } catch {
      return null
    }
  }

  /** Internal identity only; never returned through Remote. */
  ownedBrowser() {
    const state = this.registry.get(this.profile)
    if (!state || typeof state.websocket !== 'string' || state.websocket === '') return undefined
    return {
      websocket: state.websocket,
      mode: 'headed',
      alive: Boolean(state.child && state.exited !== true),
    }
  }

  /** Internal identity only; never returned through Remote. */
  async verifiedWebSocket() {
    return (await this.verifiedOwnership()).websocket
  }

  /** Internal ownership identity after a live `/json/version` read-back. */
  async verifiedOwnership() {
    const owned = this.ownedBrowser()
    if (owned === undefined) throw new Error('本插件没有启动并拥有的专用浏览器；不会接管端口上已经存在的浏览器。请点击“连接 / 登录专用浏览器”。')
    const result = await this.status()
    if (result.ready !== true) throw new Error(result.message)
    const live = this.ownedBrowser()
    if (live === undefined || live.websocket !== owned.websocket) throw new Error('专用浏览器身份在读取过程中发生变化；拒绝继续。')
    return live
  }

  /**
   * Start or reuse the dedicated visible background browser.
   * @returns the verified readiness result.
   */
  async open() {
    if (this.registry.closing) throw new Error('专用浏览器正在随 DSH 清理，不能启动新工作。')
    const key = this.profile
    const previous = this.registry.get(key)
    const endpoint = managedEndpoint(this.cdpUrl)
    if (previous?.pending) {
      if (previous.pendingEndpoint !== endpoint.url) throw new Error('另一调试端口的专用浏览器正在启动，请等待完成后重试。')
      return await previous.pending
    }
    const state = previous ?? {}
    state.pendingEndpoint = endpoint.url
    const pending = this.start(state)
    state.pending = pending
    this.registry.set(key, state)
    try { return await pending } finally { state.pending = null }
  }

  /** Internal host lifecycle, deliberately not a Remote endpoint. All ports share this registry. */
  async closeAllOwned() {
    if (this.registry.closing) return await this.registry.closing
    const closing = (async () => {
      const entries = [...this.registry.entries()]
      return await Promise.all(entries.map(async ([key, state]) => {
        // A launch already accepted by the serial queue must finish before cleanup.
        try { await state.pending } catch { /* still inspect any identity it emitted */ }
        const child = state.child
        const websocket = state.websocket
        const guardian = state.guardian
        let result = { closed: false, reason: '没有可验证的本插件启动身份；未关闭浏览器。' }
        try {
          if (child && websocket && state.endpoint) {
            result = await closeExactBrowser(state.endpoint, websocket, base => this.readVersion(base), () => state.exited === true)
          } else if (!child || state.exited) result = { closed: true, reason: '' }
          return result
        } finally {
          // Success disarms the guardian. A failed close instead ends its pipe so
          // it independently retries the same exact identity, then exits boundedly.
          if (result.closed || !websocket) guardian?.release()
          else guardian?.cleanup()
          state.guardian = null
          if (this.registry.get(key) === state) this.registry.delete(key)
        }
      }))
    })()
    this.registry.closing = closing
    try { return await closing } finally { if (this.registry.closing === closing) this.registry.closing = null }
  }

  async start(state) {
    if ((this.options.platform ?? process.platform) !== 'win32') throw new Error('一键打开目前仅支持 Windows；其他系统请手动配置本机 CDP 浏览器。')
    const endpoint = managedEndpoint(this.cdpUrl)
    const current = await this.status()
    if (current.ready) {
      // Preserve an already-owned browser across module reloads, but never leave
      // it without a live guardian (old registry entries predate this lifecycle).
      if (!state.guardian?.alive) {
        state.guardian?.release()
        const guardian = await startGuardian(this.options.startTimeoutMs)
        try { await guardian.arm(endpoint.url, state.websocket) } catch (error) { guardian.release(); throw error }
        state.guardian = guardian
        state.child.once('exit', () => {
          guardian.release()
          if (state.guardian === guardian) state.guardian = null
        })
      }
      if (state.windowHandle) {
        await ownedWindow(state.child.pid, true, 5000, state.windowHandle)
        state.windowHandle = null
      }
      return current
    }
    if (state.child && !state.exited) {
      throw new Error('专用浏览器仍在启动或尚未完全退出。请在任务栏打开它完成登录；若无响应，请手动退出该专用浏览器后重试。')
    }
    await (this.options.portFree ?? portFree)(endpoint.port)
    const executable = await (this.options.discover ?? discover)(process.env)
    await (this.options.mkdir ?? mkdir)(this.profile, { recursive: true })
    const guardian = await startGuardian(this.options.startTimeoutMs)
    state.endpoint = endpoint.url
    state.mode = 'headed'
    state.websocket = null
    state.exited = false
    state.guardian = guardian
    let child
    try {
      child = (this.options.spawn ?? spawn)(executable, dedicatedArgs({ profile: this.profile, port: endpoint.port }), {
        shell: false,
        detached: true,
        windowsHide: false,
        stdio: ['ignore', 'ignore', 'pipe'],
      })
    } catch (error) {
      state.exited = true
      guardian.release()
      state.guardian = null
      throw error
    }
    state.child = child
    // Observe only the CDP endpoint emitted by this child. Never adopt an arbitrary listener.
    return await new Promise((resolve, reject) => {
      let settled = false
      let text = ''
      const finish = (error, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.stderr?.off('data', onData)
        child.stderr?.unref?.()
        child.unref?.()
        if (error && !state.websocket) {
          guardian.release()
          if (state.guardian === guardian) state.guardian = null
        }
        if (error) reject(error); else resolve(value)
      }
      const timer = setTimeout(() => finish(new Error('浏览器未在规定时间内开放 CDP。请检查专用浏览器窗口；企业策略可能禁用了远程调试。不会关闭任何浏览器。')), this.options.startTimeoutMs ?? 15000)
      const onData = (chunk) => {
        text = (text + String(chunk)).slice(-8192)
        const match = text.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-zA-Z0-9-]+)/u)
        if (!match || state.websocket) return
        const socket = new URL(match[1])
        if (Number(socket.port) !== endpoint.port) return finish(new Error('专用浏览器返回了非配置调试端口；拒绝接管。'))
        state.websocket = match[1]
        // Arm immediately from this child's output, before any asynchronous read.
        // Both paths independently verify /json/version before sending a close.
        void (async () => {
          await guardian.arm(endpoint.url, state.websocket)
          const result = await this.status()
          if (!result.ready || !guardian.alive) throw new Error(result.ready ? '专用浏览器生命周期守护进程已断开。' : result.message)
          finish(null, result)
        })().catch(finish)
      }
      child.stderr?.on('data', onData)
      const onExit = () => {
        if (state.child === child) state.exited = true
        guardian.release()
        if (state.guardian === guardian) state.guardian = null
      }
      child.on('error', () => { onExit(); finish(new Error('无法启动专用浏览器。请确认 Edge/Chrome 安装完整且允许本机远程调试。')) })
      child.on('exit', () => { onExit(); finish(new Error('专用浏览器已退出或已有同一专用配置目录的窗口。请先手动退出该专用浏览器，然后重新打开。')) })
    })
  }

  /**
   * Best-effort, owned-only minimize. The browser, its tabs, profile and login
   * are untouched; only the window state is requested. A refusal or an
   * unverifiable identity is reported and never retried another way.
   * @param expectedWebSocket - the identity the host already verified.
   * @returns `{ minimized, reason }`; never throws for a refusal.
   */
  /** Restore only our verified browser window, without opening or navigating a tab. */
  async showOwned(expectedWebSocket) {
    const owned = await this.verifiedOwnership()
    if (owned.websocket !== expectedWebSocket) throw new Error('专用浏览器身份已变化，未操作窗口。')
    const state = this.registry.get(this.profile)
    await ownedWindow(state.child.pid, true, this.options.minimizeTimeoutMs ?? 5000, state.windowHandle)
    state.windowHandle = null
    return { visible: true }
  }

  async minimizeOwned(expectedWebSocket) {
    const endpoint = managedEndpoint(this.cdpUrl)
    const state = this.registry.get(this.profile)
    const decision = ownershipAllowed({
      ownedWebsocket: state?.websocket,
      candidateWebsocket: expectedWebSocket,
      childAlive: Boolean(state?.child && state.exited !== true),
    })
    if (decision.allowed !== true) return { minimized: false, reason: `拒绝最小化：${decision.reason}。不会按端口或 PID 操作任何浏览器。` }
    let version
    try {
      version = await this.readVersion(endpoint.url)
    } catch (error) {
      return { minimized: false, reason: `无法读回专用浏览器身份，未最小化：${error instanceof Error ? error.message : String(error)}` }
    }
    if (version.webSocketDebuggerUrl !== state.websocket) return { minimized: false, reason: '读回的浏览器身份与本次启动输出不一致；未最小化，也不会按端口或 PID 操作任何浏览器。' }
    try {
      if (state.windowHandle) {
        await ownedWindow(state.child.pid, false, this.options.minimizeTimeoutMs ?? 5000, state.windowHandle)
        return { minimized: true, reason: '' }
      }
      const handle = await (this.options.minimize ?? minimizeDefault)(state.websocket, this.options.minimizeTimeoutMs ?? 5000, state.child.pid)
      if (typeof handle === 'number') state.windowHandle = handle
      return { minimized: true, reason: '' }
    } catch (error) {
      return { minimized: false, reason: `最小化未完成：${error instanceof Error ? error.message : String(error)}` }
    }
  }
}
