/**
 * The one wire contract for every `chatgptComposer` Remote endpoint.
 *
 * `lib/typert.host.js` and `lib/typert.remote-client.js` are built from this
 * module, and `scripts/check.mjs` loads it to prove the browser bundle's inline
 * descriptor set is the same wire (endpoint set, parameter wires, strict codecs,
 * type symbols and JSON Schema projections). That check is what keeps the two
 * faces of the loader's unavoidable inlining from drifting apart.
 *
 * @module dsh-chatgpt-composer/contract
 */

import { z } from 'zod'

/** Package name owning this contract. */
export const PACKAGE = 'dsh-chatgpt-composer'

/** Remote namespace this package mounts. */
export const NAMESPACE = 'chatgptComposer'

/** Every endpoint, in declaration order; `@Remote` markers must match. */
export const ENDPOINTS = [
  'probe',
  'readState',
  'readModelMenu',
  'selectModel',
  'selectChat',
  'newChat',
  'bind',
  'setActive',
  'unbind',
  'status',
]

/**
 * Project one schema factory to JSON Schema.
 * The published generator emits its own projection style; this package derives
 * the same information from the Zod schema so the projection cannot disagree
 * with the runtime parser. Old Zod builds without `toJSONSchema` yield no
 * projection, which the loader accepts and the check reports as a failure.
 * @param create - schema factory.
 * @param io - projection direction.
 * @returns the JSON Schema, or undefined when the build cannot project.
 */
const jsonSchemaOf = (create, io) => (typeof z.toJSONSchema === 'function' ? z.toJSONSchema(create(), { io, unrepresentable: 'any' }) : undefined)

//#region shared result fragments

const account$schema = () => z.object({
  label: z.string().nullable().describe('accessible label of the profile menu button.'),
  initial: z.string().nullable().describe('avatar initial; a label-level fact, never an identity.'),
}).nullable()

const strength$schema = () => z.object({
  controlLabel: z.string().nullable().describe('accessible label of the thinking-effort control, e.g. 强度.'),
  value: z.string().nullable().describe('visible strength text when the page renders one.'),
  sliderValue: z.number().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
}).nullable().describe('the thinking-effort control; it is not a model and is never bound as one.')

const modelButton$schema = () => z.object({
  controlLabel: z.string().describe('accessible label of the composer model control.'),
  composerText: z.string().describe('visible text of that control, which ChatGPT may combine with the active thinking effort.'),
  strength: strength$schema(),
}).nullable()

const tab$schema = () => z.object({
  id: z.string().describe('CDP target id; a binding pins exactly this tab.'),
  url: z.string(),
  title: z.string(),
  chatId: z.string().nullable().describe('conversation id parsed from /c/<id>; null on the ChatGPT root.'),
})

const chat$schema = () => z.object({
  id: z.string(),
  title: z.string(),
}).describe('one conversation link the sidebar rendered; never a complete-history claim.')

const modelOption$schema = () => z.object({
  index: z.number(),
  text: z.string().describe('label of one model radio in the menu.'),
  checked: z.boolean(),
})

const menuItem$schema = () => z.object({
  index: z.number(),
  label: z.string(),
  text: z.string(),
  kind: z.enum(['strength', 'item']).describe('a strength control or an ordinary menu entry; neither is a model.'),
  sliderValue: z.number().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
})

const menu$schema = () => z.object({
  open: z.boolean(),
  models: z.array(modelOption$schema()).describe('role=menuitemradio entries; only these are models.'),
  items: z.array(menuItem$schema()).describe('role=menuitem entries, including the strength control.'),
})

const fingerprint$schema = () => z.object({
  targetId: z.string(),
  url: z.string(),
  chatId: z.string().nullable(),
  accountLabel: z.string().nullable(),
  accountInitial: z.string().nullable(),
})

const readbackVerdict$schema = () => z.object({
  target: z.enum(['ok', 'unverified']),
  model: z.enum(['selection-only', 'unverified']),
  account: z.enum(['unverified']).describe('the rendered page exposes no account identity, so this verdict can only be unverified.'),
  checkedModel: z.boolean().nullable().describe('the menu radio read-back behind the model verdict; null when no menu read was part of it.'),
  notes: z.array(z.string()),
})

const verification$schema = () => z.object({
  target: z.enum(['ok', 'unverified']),
  model: z.enum(['selection-only', 'unverified']),
  account: z.enum(['unverified']),
  targetKind: z.enum(['existing', 'new']),
  chatId: z.string().nullable(),
  modelName: z.string().nullable(),
  checkedModel: z.boolean().nullable(),
  fingerprints: z.object({ before: fingerprint$schema(), after: fingerprint$schema() }).nullable(),
  notes: z.array(z.string()),
})

const binding$schema = () => z.object({
  sessionId: z.string(),
  active: z.boolean().describe('false keeps the binding while stopping context injection.'),
  target: z.object({
    kind: z.enum(['existing', 'new']),
    targetId: z.string(),
    chatId: z.string().nullable(),
    title: z.string().nullable(),
    url: z.string(),
  }),
  model: z.object({
    selectedAt: z.string().describe('time of the explicit menu selection; not a live model identity claim.'),
    name: z.string().describe('label of the checked model radio; never the strength text.'),
    controlLabel: z.string(),
    composerText: z.string(),
    strength: z.string().nullable(),
  }),
  account: account$schema(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
  verifiedAt: z.string(),
  liveCheckedAt: z.string().nullable(),
  verification: verification$schema(),
  stale: z.boolean().describe('a failed live check keeps the binding and stops injection.'),
  staleReason: z.string().nullable(),
  staleAt: z.string().nullable(),
  cdpUrl: z.string(),
})

//#endregion

//#region requests

const targetIdField = () => z.string().describe('CDP target id of the ChatGPT tab the action targets.')
const sessionField = () => z.string().describe('the DSH session whose binding this action belongs to.')

const REQUEST = {
  readState: {
    fields: { targetId: targetIdField().optional() },
    strict: { targetId: targetIdField().optional() },
  },
  readModelMenu: {
    fields: { sessionId: sessionField(), targetId: targetIdField() },
    strict: { sessionId: sessionField(), targetId: targetIdField() },
  },
  selectModel: {
    fields: { sessionId: sessionField(), targetId: targetIdField(), modelIndex: z.number().optional(), modelName: z.string().optional() },
    strict: { sessionId: sessionField(), targetId: targetIdField(), modelIndex: z.number().optional(), modelName: z.string().optional() },
  },
  selectChat: {
    fields: { sessionId: sessionField(), targetId: targetIdField(), chatId: z.string() },
    strict: { sessionId: sessionField(), targetId: targetIdField(), chatId: z.string() },
  },
  newChat: {
    fields: { sessionId: sessionField(), targetId: targetIdField() },
    strict: { sessionId: sessionField(), targetId: targetIdField() },
  },
  bind: {
    fields: { sessionId: sessionField(), targetId: targetIdField(), targetKind: z.enum(['existing', 'new']), chatId: z.string().optional(), modelName: z.string() },
    strict: { sessionId: sessionField(), targetId: targetIdField(), targetKind: z.enum(['existing', 'new']), chatId: z.string().optional(), modelName: z.string() },
  },
  setActive: {
    fields: { sessionId: sessionField(), active: z.boolean() },
    strict: { sessionId: sessionField(), active: z.boolean() },
  },
  unbind: {
    fields: { sessionId: sessionField() },
    strict: { sessionId: sessionField() },
  },
  status: {
    fields: { sessionId: sessionField(), refresh: z.boolean().optional() },
    strict: { sessionId: sessionField(), refresh: z.boolean().optional() },
  },
}

//#endregion

//#region endpoint specifications

/** Method descriptions and result schemas, keyed by method name. */
export const ENDPOINT_SPECS = {
  probe: {
    description: 'Read the configured DevTools endpoint only: reachability, browser product, and the ChatGPT tabs currently open. Runs no page code and always answers with a chatgptTabs array.',
    result: {
      description: 'browser facts and the ChatGPT tabs currently open.',
      create: () => z.object({
        generation: z.number(),
        cdpUrl: z.string(),
        reachable: z.boolean(),
        browser: z.string().nullable(),
        protocolVersion: z.string().nullable(),
        chatgptTabs: z.array(tab$schema()).describe('always an array, empty when the endpoint is unreachable.'),
        error: z.string().nullable(),
        generatedAt: z.string(),
      }),
    },
  },
  readState: {
    description: 'Read what one ChatGPT tab already rendered: sidebar chats, the active conversation id, the composer model control and the profile label. Pure DOM read: no click, no navigation, no network request, no credential.',
    result: {
      description: 'normalized read-only facts for one tab.',
      create: () => z.object({
        generation: z.number(),
        cdpUrl: z.string(),
        targetId: z.string().nullable(),
        url: z.string(),
        title: z.string(),
        chatId: z.string().nullable(),
        chats: z.array(chat$schema()),
        modelButton: modelButton$schema(),
        menu: menu$schema(),
        account: account$schema(),
        composer: z.object({ found: z.boolean(), empty: z.boolean() }),
        notes: z.array(z.string()),
        labelPatterns: z.object({ model: z.string(), account: z.string() }),
        generatedAt: z.string(),
      }),
    },
  },
  readModelMenu: {
    description: 'Explicitly open the composer model menu in one tab, read its role=menuitemradio model options and its role=menuitem strength control, then close the menu with Escape and verify it closed. Selects nothing.',
    result: {
      description: 'the menu contents read between an explicit open and a verified close.',
      create: () => z.object({
        sessionId: z.string(),
        targetId: z.string(),
        url: z.string(),
        opened: z.boolean(),
        closed: z.boolean(),
        modelControlLabel: z.string().nullable(),
        composerText: z.string(),
        strength: strength$schema(),
        models: z.array(modelOption$schema()),
        checkedModel: modelOption$schema().nullable(),
        items: z.array(menuItem$schema()),
        notes: z.array(z.string()),
        readAt: z.string(),
      }),
    },
  },
  selectModel: {
    description: 'Explicitly select one model radio in the composer menu, then reopen the menu and read aria-checked back for the chosen option. The verified selection is recorded for this session and is required by bind.',
    result: {
      description: 'the requested model and the checked read-back that confirms or refutes it.',
      create: () => z.object({
        sessionId: z.string(),
        targetId: z.string(),
        selected: z.boolean(),
        requested: z.object({ index: z.number().nullable(), name: z.string().nullable() }),
        checkedModel: modelOption$schema().nullable(),
        readBack: z.boolean().describe('true only when the reopened menu reports the requested option as checked.'),
        modelControlLabel: z.string().nullable(),
        strength: strength$schema(),
        composerTextBefore: z.string(),
        composerTextAfter: z.string(),
        notes: z.array(z.string()),
        readAt: z.string(),
      }),
    },
  },
  selectChat: {
    description: 'Explicitly navigate one tab to an existing chat through the sidebar link when it is rendered, otherwise by URL, then verify the active conversation id and two identical target and account fingerprints.',
    result: {
      description: 'the navigation read-back for one existing chat.',
      create: () => z.object({
        sessionId: z.string(),
        targetId: z.string(),
        chatId: z.string(),
        verified: z.boolean(),
        title: z.string(),
        url: z.string(),
        fingerprints: z.object({ before: fingerprint$schema(), after: fingerprint$schema() }),
        notes: z.array(z.string()),
        readAt: z.string(),
      }),
    },
  },
  newChat: {
    description: 'Explicitly navigate one tab to the ChatGPT root through the rendered home entry when present, otherwise by URL, then verify a draft: no conversation id in the URL and an empty composer. Never types and never sends.',
    result: {
      description: 'the navigation read-back for a new-chat draft.',
      create: () => z.object({
        sessionId: z.string(),
        targetId: z.string(),
        verified: z.boolean(),
        url: z.string(),
        chatId: z.string().nullable(),
        composerFound: z.boolean(),
        draftEmpty: z.boolean(),
        fingerprints: z.object({ before: fingerprint$schema(), after: fingerprint$schema() }),
        notes: z.array(z.string()),
        readAt: z.string(),
      }),
    },
  },
  bind: {
    description: 'Bind one DSH session to the tab, target and model that were verified by explicit actions, re-reading the fingerprints and the composer text before committing. A failed read-back throws instead of claiming success.',
    result: {
      description: 'the committed binding with its read-back verdicts.',
      create: () => binding$schema(),
    },
  },
  setActive: {
    description: 'Arm or disarm context injection for one existing binding. Disarming keeps the target and model selection.',
    result: {
      description: 'the updated binding.',
      create: () => binding$schema(),
    },
  },
  unbind: {
    description: 'Drop one DSH session\'s binding.',
    result: {
      description: 'whether a binding was removed.',
      create: () => z.object({ sessionId: z.string(), removed: z.boolean() }),
    },
  },
  status: {
    description: 'Report one session\'s binding, its model-facing snapshot, whether injection is really armed for it, and the surfaces this deployment has registered.',
    result: {
      description: 'binding status for one session.',
      create: () => z.object({
        sessionId: z.string(),
        bound: z.boolean(),
        binding: binding$schema().nullable(),
        snapshot: z.string().nullable(),
        injectionArmed: z.boolean(),
        injectionAvailable: z.boolean().describe('whether this deployment registered the pre-step surface at all.'),
        toolName: z.string(),
        preStep: z.object({ enabled: z.boolean(), appended: z.number(), failed: z.string().nullable() }),
        cdpUrl: z.string(),
        lastReadGeneration: z.number(),
        generatedAt: z.string(),
      }),
    },
  },
}

//#endregion

/**
 * Build one named request parameter for the host artifact.
 * @param method - endpoint whose request object this is.
 * @returns the parameter spec.
 */
function requestParameter(method) {
  const { fields, strict } = REQUEST[method]
  const create = () => z.object(fields)
  const createStrict = () => z.strictObject(strict)
  const typeSymbol = `${PACKAGE}#${NAMESPACE}/${method}:request`
  return {
    name: 'request',
    wire: 'request',
    description: `the ${method} request object.`,
    source: 'json',
    codec: { mode: 'strict', typeSymbol, create, jsonSchema: jsonSchemaOf(create, 'input') },
    strictCodec: { mode: 'strict', typeSymbol, create: createStrict, jsonSchema: jsonSchemaOf(createStrict, 'input') },
  }
}

/**
 * Build the `createTypertRemoteInfo` specification for this contract.
 * @returns the spec object the host artifact passes to `createTypertRemoteInfo`.
 */
export function remoteInfoSpec() {
  const methods = {}
  for (const method of ENDPOINTS) {
    const spec = ENDPOINT_SPECS[method]
    methods[`${NAMESPACE}/${method}`] = {
      service: NAMESPACE,
      description: spec.description,
      invocation: { kind: 'direct' },
      parameters: REQUEST[method] === undefined ? [] : [requestParameter(method)],
      result: {
        mode: 'strict',
        typeSymbol: `${PACKAGE}#${NAMESPACE}/${method}:result`,
        create: spec.result.create,
        description: spec.result.description,
        jsonSchema: jsonSchemaOf(spec.result.create, 'output'),
      },
      sourceLocation: { file: 'lib/contract.js', line: 1, column: 1 },
    }
  }
  return { package: PACKAGE, methods }
}

/**
 * Drop every `description` key from a projection.
 *
 * Descriptions are documentation the host face owns; the browser bundle inlines
 * the wire shapes without repeating them. Comparing the projection without its
 * descriptions is what keeps the drift check about the wire — types, required
 * fields, enums, strictness — rather than about prose.
 * @param value - a JSON Schema projection.
 * @returns the same structure without description keys.
 */
function stripDescriptions(value) {
  if (Array.isArray(value)) return value.map(stripDescriptions)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      if (key !== 'description') out[key] = stripDescriptions(item)
    }
    return out
  }
  return value
}

/**
 * Reduce descriptors to the facts that must be identical on every face.
 * @param descriptors - host or browser descriptors.
 * @returns a JSON-comparable wire profile.
 */
export function descriptorProfile(descriptors) {
  return [...descriptors]
    .map((descriptor) => ({
      endpoint: `${descriptor.namespace}/${descriptor.method}`,
      invocation: descriptor.invocation.kind,
      parameters: [...descriptor.parameters]
        .map((parameter) => ({
          wire: parameter.wire,
          source: parameter.source,
          mode: parameter.codec.mode,
          typeSymbol: parameter.codec.typeSymbol,
          jsonSchema: stripDescriptions(parameter.codec.jsonSchema),
          strictMode: parameter.strictCodec?.mode ?? null,
          strictTypeSymbol: parameter.strictCodec?.typeSymbol ?? null,
          strictJsonSchema: stripDescriptions(parameter.strictCodec?.jsonSchema),
        }))
        .sort((left, right) => left.wire.localeCompare(right.wire)),
      result: {
        mode: descriptor.result.mode,
        typeSymbol: descriptor.result.typeSymbol,
        jsonSchema: stripDescriptions(descriptor.result.jsonSchema),
      },
    }))
    .sort((left, right) => left.endpoint.localeCompare(right.endpoint))
}
