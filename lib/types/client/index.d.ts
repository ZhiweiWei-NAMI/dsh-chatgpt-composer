/** Browser registration for ChatGPT Mirror, mounted by the public DSH module loader. */

/** Public services this plugin waits for before applying. */
export declare const inject: readonly ['slots', 'remote', 'layout', 'sessions']

/** Public external-store face used by panel selection and current-session leases. */
export interface SnapshotSource<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** Accepted browser visibility request; never changes the selected ChatGPT page. */
export interface SetWindowVisibleRequest {
  visible: boolean
}

/**
 * Register the keyed main panel, sidebar.panellist navigation glyph, additive
 * sidebar.footer.action history and accepted conversation.input.right account popover.
 * Login, real account details and port settings live only in that popover.
 * Does not replace sidebar.workspaces; panel/footer mounting never re-scans history.
 * Mounts the accepted six RPCs and shares one account/history cache and attachment flow.
 */
export declare function apply(ctx: {
  effect(callback: () => unknown, label: string): unknown
  slots: {
    inject(name: string, callback: () => unknown): unknown
    register(options: Record<string, unknown>, component: unknown): unknown
  }
  remote: { $mount(contribution: { package: string; descriptors: unknown[] }): Promise<() => Promise<void> | void> }
  layout: {
    selectPanel(panelId: string | null): void
    panelInfo: SnapshotSource<{ activePanelId: string | null }>
  }
  /** Service lookup; sessions is a required public dependency. */
  get(key: string): unknown
}): void
