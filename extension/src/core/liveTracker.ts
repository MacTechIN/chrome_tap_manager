// core/liveTracker.ts — owns the LiveState in the service worker:
//   • restores the last `seq` from session storage so the cursor stays monotonic
//     across SW restarts,
//   • rebuilds the full state from a snapshot loader (windows.getAll) on start,
//   • applies incoming events through the pure reducer,
//   • persists to session storage (debounced) and notifies listeners.
// Chrome-specific pieces (event subscription, snapshot loader, storage) are injected.

import { emptyLiveState, type LiveEvent, type LiveState, reduce } from './liveState';
import type { KeyValueStore } from './repo';

export const LIVE_STATE_KEY = 'ctm:live';

export type LiveListener = (state: LiveState, event: LiveEvent) => void;

export interface LiveTrackerOptions {
  /** Session-scoped KV (chrome.storage.session). */
  kv: KeyValueStore;
  /** Returns a full 'init' snapshot event. */
  loadSnapshot: () => Promise<LiveEvent>;
  /** Registers Chrome listeners; must call `dispatch` for each event. Returns unsubscribe. */
  subscribe: (dispatch: (e: LiveEvent) => void) => () => void;
  /** Debounce for session persistence, ms. 0 = write synchronously after each event. */
  persistDelayMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  log?: (msg: string, data?: unknown) => void;
}

export class LiveTracker {
  private state: LiveState = emptyLiveState();
  private started = false;
  private starting: Promise<void> | undefined;
  private unsubscribe: (() => void) | undefined;
  private listeners = new Set<LiveListener>();
  private pending: LiveEvent[] = [];
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private persistChain: Promise<void> = Promise.resolve();

  constructor(private readonly opts: LiveTrackerOptions) {}

  get current(): LiveState {
    return this.state;
  }

  get isStarted(): boolean {
    return this.started;
  }

  /**
   * Subscribe listeners immediately (so nothing is missed), then restore the
   * seq cursor and rebuild from a fresh snapshot. Events that arrive while the
   * snapshot is loading are queued and replayed on top of it.
   */
  start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = this.doStart();
    return this.starting;
  }

  private async doStart(): Promise<void> {
    this.unsubscribe = this.opts.subscribe((e) => this.dispatch(e));

    const saved = await this.opts.kv.get<LiveState>(LIVE_STATE_KEY);
    const seq = saved?.seq ?? 0;

    const snapshot = await this.opts.loadSnapshot();
    let state = reduce(emptyLiveState(seq), snapshot);
    const queued = this.pending;
    this.pending = [];
    for (const e of queued) state = reduce(state, e);

    this.state = state;
    this.started = true;
    this.opts.log?.('live tracker started', {
      seq: state.seq,
      restoredSeq: saved?.seq,
      windows: Object.keys(state.windows).length,
      tabs: Object.keys(state.tabs).length,
      replayed: queued.length,
    });
    this.schedulePersist();
    for (const l of this.listeners) l(this.state, snapshot);
  }

  dispatch(event: LiveEvent): void {
    if (!this.started) {
      this.pending.push(event);
      return;
    }
    this.state = reduce(this.state, event);
    this.schedulePersist();
    for (const l of this.listeners) l(this.state, event);
  }

  onChange(listener: LiveListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Force a full re-sync from the snapshot loader (e.g. after suspected missed events). */
  async resync(): Promise<void> {
    const snapshot = await this.opts.loadSnapshot();
    this.dispatch(snapshot);
  }

  /** Waits until any pending persistence has been written. Test helper / shutdown. */
  async flush(): Promise<void> {
    if (this.persistTimer !== undefined) {
      (this.opts.clearTimeoutFn ?? clearTimeout)(this.persistTimer);
      this.persistTimer = undefined;
      this.persistNow();
    }
    await this.persistChain;
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.listeners.clear();
  }

  private schedulePersist(): void {
    const delay = this.opts.persistDelayMs ?? 250;
    if (delay <= 0) {
      this.persistNow();
      return;
    }
    if (this.persistTimer !== undefined) return;
    this.persistTimer = (this.opts.setTimeoutFn ?? setTimeout)(() => {
      this.persistTimer = undefined;
      this.persistNow();
    }, delay);
  }

  private persistNow(): void {
    const snapshot = this.state;
    this.persistChain = this.persistChain
      .then(() => this.opts.kv.set(LIVE_STATE_KEY, snapshot))
      .catch((err) => this.opts.log?.('live state persist failed', err));
  }
}
