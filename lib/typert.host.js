/* Hand-authored in the published @deepseek-ai/dsh-typert-generator format.
 *
 * DSH ships the Typert loader, registry and protocol but not the generator, so
 * this artifact is written in exactly the format the generator emits: one
 * `createTypertRemoteInfo(spec, z)` call over strict codecs, plus the `TYPERT`
 * host manifest. The endpoint list, request codecs, result schemas and JSON
 * Schema projections all come from lib/contract.js, which is also what the
 * browser bundle's inline contribution is checked against.
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
        description: 'Binds one DSH session to one ChatGPT web tab, conversation and model over a read-only CDP attachment to the browser the user already runs. Explicit clicks and navigation happen only for the actions the composer toggle asks for.',
        summary: 'Binds one DSH session to one verified ChatGPT web tab, conversation and model over a read-only CDP attachment.',
        tags: [],
        jsDoc: '/** Host half: read-only ChatGPT target binding, its Remote surface and the read-only chatgpt_target tool. */',
        key: 'chatgptComposer',
        exportName: 'ChatGptComposerService',
        members: [
          member('probe', '@Remote async probe(): Promise<ProbeResult>', 'Read the DevTools endpoint and the ChatGPT tabs currently open; runs no page code.'),
          member('readState', '@Remote async readState(request: { targetId?: string }): Promise<ReadStateResult>', 'Read one tab\'s rendered chats, conversation id, model control and profile label.'),
          member('readModelMenu', '@Remote async readModelMenu(request: ReadModelMenuRequest): Promise<ReadModelMenuResult>', 'Open the model menu, read its model radios and strength control, then close it and verify the close.'),
          member('selectModel', '@Remote async selectModel(request: SelectModelRequest): Promise<SelectModelResult>', 'Select one model radio and read aria-checked back from a reopened menu.'),
          member('selectChat', '@Remote async selectChat(request: SelectChatRequest): Promise<SelectChatResult>', 'Navigate to an existing chat and verify the active conversation id plus two fingerprints.'),
          member('newChat', '@Remote async newChat(request: NewChatRequest): Promise<NewChatResult>', 'Navigate to the ChatGPT root and verify an empty draft; never types and never sends.'),
          member('bind', '@Remote async bind(request: BindRequest): Promise<Binding>', 'Bind the verified tab, target and model, re-reading them before committing.'),
          member('setActive', '@Remote async setActive(request: SetActiveRequest): Promise<Binding>', 'Arm or disarm context injection while keeping the binding.'),
          member('unbind', '@Remote async unbind(request: { sessionId: string }): Promise<{ sessionId: string; removed: boolean }>', 'Drop one session\'s binding.'),
          member('status', '@Remote async status(request: { sessionId: string }): Promise<StatusResult>', 'Report one session\'s binding, its snapshot and the surfaces really armed.'),
        ],
        types: [
          { name: 'Binding', declaration: 'export interface Binding {\n    readonly sessionId: string;\n    readonly active: boolean;\n    readonly target: { readonly kind: \'existing\'; readonly targetId: string; readonly chatId: string; readonly title: string; readonly url: string; } | { readonly kind: \'new\'; readonly targetId: string; readonly chatId: null; readonly title: null; readonly url: string; };\n    readonly model: { readonly name: string; readonly controlLabel: string; readonly composerText: string; readonly strength: string | null; };\n    readonly account: { readonly label: string | null; readonly initial: string | null; } | null;\n    readonly createdAt: string;\n    readonly updatedAt: string | null;\n    readonly verifiedAt: string;\n    readonly verification: ReadbackVerdicts;\n    readonly stale: boolean;\n    readonly staleReason: string | null;\n    readonly staleAt: string | null;\n    readonly cdpUrl: string;\n}' },
          { name: 'ReadbackVerdicts', declaration: 'export interface ReadbackVerdicts {\n    readonly target: \'ok\' | \'unverified\';\n    readonly model: \'ok\' | \'unverified\';\n    readonly account: \'unverified\';\n    readonly targetKind: \'existing\' | \'new\';\n    readonly chatId: string | null;\n    readonly modelName: string | null;\n    readonly checkedModel: boolean | null;\n    readonly fingerprints: { readonly before: Fingerprint; readonly after: Fingerprint } | null;\n    readonly notes: readonly string[];\n}' },
          { name: 'Fingerprint', declaration: 'export interface Fingerprint {\n    readonly targetId: string;\n    readonly url: string;\n    readonly chatId: string | null;\n    readonly accountLabel: string | null;\n    readonly accountInitial: string | null;\n}' },
        ],
      },
    ],
    events: [],
    objects: [],
  },
}

export default TYPERT
