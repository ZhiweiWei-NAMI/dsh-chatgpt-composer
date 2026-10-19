/* Hand-authored in the published @deepseek-ai/dsh-typert-generator format.
 *
 * DSH ships the Typert loader, registry and protocol but not the generator, so
 * this artifact is written in exactly the format the generator emits: one
 * `createTypertRemoteInfo(spec, z)` call over strict codecs, plus the `TYPERT`
 * host manifest. The endpoint list, request codecs, result schemas and JSON
 * Schema projections all come from lib/contract.js, which is also what the
 * browser bundle's inline contribution mirrors.
 *
 * The loader registers this file for this package through exports["./typert"].
 */
import { z } from 'zod'

import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'

import { PACKAGE, remoteInfoSpec } from './contract.js'

const $remote = createTypertRemoteInfo(remoteInfoSpec(), z)

/** Documentation for one service member, in the generator's manifest shape. */
const member = (name, signature, summary) => ({ kind: 'method', name, signature, summary })

export const TYPERT = {
  package: PACKAGE,
  face: 'host',
  schemas: [],
  get invocations() { return $remote.descriptors },
  model: {
    services: [
      {
        description: 'Connects one dedicated visible background browser read-only: rendered-UI sign-in, the rendered conversation list, and the rendered turns of any conversation. It never sends, uploads, creates or switches a conversation, selects a model, reads credentials, closes a browser or starts a headless one.',
        summary: 'Read-only ChatGPT background-browser connection, history list and conversation transcript.',
        tags: [],
        jsDoc: '/** Host half: read-only ChatGPT connection, rendered history list and conversation reads. */',
        key: 'chatgptComposer',
        exportName: 'ChatGptComposerService',
        members: [
          member('openBrowser', '@Remote async openBrowser(): Promise<OnboardingResult>', 'Open or reuse the owned visible background browser, foreground ChatGPT, read the rendered sign-in state and optionally minimize the owned window after a verified sign-in.'),
          member('accountStatus', '@Remote async accountStatus(): Promise<AccountStatus>', 'Report the owned browser, the rendered sign-in state, the account label and whether the account is connected. Needs no target or model binding.'),
          member('listChats', '@Remote async listChats(request: { targetId?: string }): Promise<ChatList>', 'List the conversations the ChatGPT sidebar currently renders, with each link\'s conversation id, title and URL.'),
          member('readConversation', '@Remote async readConversation(request: { targetId?: string; chatId?: string }): Promise<ConversationRead>', 'Read the rendered turns of the current conversation or of a conversation named by chatId, without navigating the user\'s page.'),
          member('setWindowVisible', '@Remote async setWindowVisible(request: { visible: boolean }): Promise<{ visible: boolean }>', 'Show or hide only the verified dedicated browser window; keep its process and connection running.'),
          member('setPort', '@Remote async setPort(request: { port: number }): Promise<{ cdpUrl: string }>', 'Change the loopback DevTools port (1024–65535) this plugin connects to; never launches a browser and never reports a login verdict.'),
        ],
        types: [
          { name: 'ChatList', declaration: 'export interface ChatList {\n    readonly targetId: string | null;\n    readonly chats: readonly { readonly chatId: string; readonly title: string; readonly url: string; }[];\n    readonly complete: boolean;\n    readonly generatedAt: string;\n}' },
          { name: 'ConversationRead', declaration: 'export interface ConversationRead {\n    readonly generation: number;\n    readonly cdpUrl: string;\n    readonly targetId: string | null;\n    readonly url: string;\n    readonly title: string;\n    readonly chatId: string | null;\n    readonly messages: readonly { readonly index: number; readonly role: \'user\' | \'assistant\' | \'system\' | \'tool\' | \'unknown\'; readonly text: string; }[];\n    readonly rendered: number;\n    readonly truncated: boolean;\n    readonly limits: { readonly messages: number; readonly charactersPerMessage: number; readonly totalCharacters: number };\n    readonly notes: readonly string[];\n    readonly generatedAt: string;\n}' },
        ],
      },
    ],
    events: [],
    objects: [],
  },
}

export default TYPERT
