/* Hand-authored in the published @deepseek-ai/dsh-typert-generator format.
 *
 * The client face of the same contract: `exports["./remote"]` for a typed
 * consumer, built from lib/contract.js so it cannot disagree with the host
 * artifact. Inside the browser the module loader resolves only a package root
 * and `<id>/client`, never an arbitrary subpath, so lib/client.js inlines an
 * equivalent descriptor set instead of importing this file; scripts/check.mjs
 * asserts the inlined set is the same wire.
 */
import { z } from 'zod'

import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'

import { PACKAGE, remoteInfoSpec } from './contract.js'

export const TYPERT_REMOTE = createTypertRemoteInfo(remoteInfoSpec(), z)

/** The package this face belongs to. */
export const packageName = PACKAGE

export default TYPERT_REMOTE
