/**
 * Typings for dsh-chatgpt-composer's browser half (`exports["./client"]`).
 *
 * The bundle is a `window.__ModuleLoader__.load({ id, factory })` registration
 * that the DSH Web client loader mounts. Its shape is exactly the Cordis plugin
 * shape the loader consumes: `apply(ctx)` plus a service-name `inject` list.
 */

/** Cordis service names this browser plugin waits for before it applies. */
export declare const inject: readonly ['slots', 'remote']

/**
 * Register the composer-right slot and mount this bundle's Remote contribution.
 * @param ctx - the client root context supplied by the module loader.
 */
export declare function apply(ctx: {
  effect(callback: () => unknown, label: string): unknown
  slots: {
    inject(name: string, callback: () => unknown): unknown
    register(options: Record<string, unknown>, component: unknown): unknown
  }
  remote: { $mount(contribution: { package: string; descriptors: unknown[] }): Promise<() => Promise<void> | void> }
  get(key: string): unknown
}): void
