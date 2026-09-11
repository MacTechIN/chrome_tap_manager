import { describe, expect, it } from 'vitest';
import { type LiveEvent, type LiveState, type LiveTab } from '../../src/core/liveState';
import { LIVE_STATE_KEY, LiveTracker } from '../../src/core/liveTracker';
import { MemoryKV } from '../../src/core/repo';

function tab(id: number, windowId: number, index: number): LiveTab {
  return {
    id,
    windowId,
    index,
    url: `https://x/${id}`,
    title: `T${id}`,
    active: index === 0,
    pinned: false,
  };
}

const SNAPSHOT: LiveEvent = {
  type: 'init',
  windows: [{ id: 10, focused: true, tabs: [tab(1, 10, 0), tab(2, 10, 1)] }],
};

interface Harness {
  kv: MemoryKV;
  tracker: LiveTracker;
  emit: (e: LiveEvent) => void;
  unsubscribed: () => boolean;
  releaseSnapshot: () => void;
  snapshotCalls: () => number;
}

function harness(opts: { deferSnapshot?: boolean; persistDelayMs?: number } = {}): Harness {
  const kv = new MemoryKV();
  let dispatch: ((e: LiveEvent) => void) | undefined;
  let unsubscribed = false;
  let release: (() => void) | undefined;
  let snapshotCalls = 0;

  const tracker = new LiveTracker({
    kv,
    persistDelayMs: opts.persistDelayMs ?? 0,
    subscribe: (d) => {
      dispatch = d;
      return () => {
        unsubscribed = true;
      };
    },
    loadSnapshot: () => {
      snapshotCalls++;
      if (!opts.deferSnapshot) return Promise.resolve(SNAPSHOT);
      return new Promise<LiveEvent>((resolve) => {
        release = () => resolve(SNAPSHOT);
      });
    },
  });

  return {
    kv,
    tracker,
    emit: (e) => {
      if (!dispatch) throw new Error('not subscribed');
      dispatch(e);
    },
    unsubscribed: () => unsubscribed,
    releaseSnapshot: () => release?.(),
    snapshotCalls: () => snapshotCalls,
  };
}

describe('LiveTracker', () => {
  it('start(): subscribes, loads snapshot, persists state with seq 1', async () => {
    const h = harness();
    await h.tracker.start();
    expect(h.tracker.isStarted).toBe(true);
    expect(h.tracker.current.seq).toBe(1);
    expect(Object.keys(h.tracker.current.windows)).toEqual(['10']);
    await h.tracker.flush();
    const saved = await h.kv.get<LiveState>(LIVE_STATE_KEY);
    expect(saved?.seq).toBe(1);
    expect(saved?.windows[10]?.tabIds).toEqual([1, 2]);
  });

  it('restores seq from session storage so the cursor keeps increasing across restarts', async () => {
    const kv = new MemoryKV();
    await kv.set(LIVE_STATE_KEY, { seq: 120, windows: {}, tabs: {} } satisfies LiveState);
    const tracker = new LiveTracker({
      kv,
      persistDelayMs: 0,
      subscribe: () => () => {},
      loadSnapshot: () => Promise.resolve(SNAPSHOT),
    });
    await tracker.start();
    expect(tracker.current.seq).toBe(121);
    // state itself comes from the fresh snapshot, not the stale save
    expect(tracker.current.windows[10]?.tabIds).toEqual([1, 2]);
  });

  it('queues events that arrive while the snapshot is loading and replays them after', async () => {
    const h = harness({ deferSnapshot: true });
    const starting = h.tracker.start();
    // subscribe happened synchronously; snapshot is still pending
    h.emit({ type: 'tab.created', tab: tab(3, 10, 2) });
    h.emit({ type: 'tab.activated', tabId: 3, windowId: 10 });
    expect(h.tracker.isStarted).toBe(false);

    // start() awaits kv.get before calling loadSnapshot; let that tick pass.
    await new Promise((r) => setTimeout(r, 0));
    expect(h.snapshotCalls()).toBe(1);
    h.releaseSnapshot();
    await starting;

    expect(h.tracker.current.seq).toBe(3); // init + 2 replayed
    expect(h.tracker.current.windows[10]?.tabIds).toEqual([1, 2, 3]);
    expect(h.tracker.current.tabs[3]?.active).toBe(true);
  });

  it('dispatch applies events, bumps seq, notifies listeners and persists', async () => {
    const h = harness();
    await h.tracker.start();
    const seen: string[] = [];
    h.tracker.onChange((_s, e) => seen.push(e.type));

    h.emit({ type: 'window.created', window: { id: 20, focused: false } });
    h.emit({ type: 'tab.created', tab: tab(9, 20, 0) });

    expect(seen).toEqual(['window.created', 'tab.created']);
    expect(h.tracker.current.seq).toBe(3);
    await h.tracker.flush();
    expect((await h.kv.get<LiveState>(LIVE_STATE_KEY))?.seq).toBe(3);
  });

  it('debounces persistence: many events → one write after the delay', async () => {
    const timers: (() => void)[] = [];
    const kv = new MemoryKV();
    let writes = 0;
    const countingKv = {
      get: kv.get.bind(kv),
      remove: kv.remove.bind(kv),
      set: async (k: string, v: unknown) => {
        writes++;
        await kv.set(k, v);
      },
    };
    let dispatch: ((e: LiveEvent) => void) | undefined;
    const tracker = new LiveTracker({
      kv: countingKv,
      persistDelayMs: 250,
      setTimeoutFn: ((fn: () => void) => {
        timers.push(fn);
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => {}) as typeof clearTimeout,
      subscribe: (d) => {
        dispatch = d;
        return () => {};
      },
      loadSnapshot: () => Promise.resolve(SNAPSHOT),
    });
    await tracker.start();
    expect(writes).toBe(0);
    expect(timers).toHaveLength(1);

    for (let i = 0; i < 10; i++) dispatch!({ type: 'tab.activated', tabId: 2, windowId: 10 });
    expect(timers).toHaveLength(1); // still one pending timer

    timers[0]!();
    await tracker.flush();
    expect(writes).toBe(1);
    expect((await kv.get<LiveState>(LIVE_STATE_KEY))?.seq).toBe(11);
  });

  it('resync() reloads the snapshot as a new init event', async () => {
    const h = harness();
    await h.tracker.start();
    h.emit({ type: 'window.created', window: { id: 20, focused: false } });
    expect(Object.keys(h.tracker.current.windows)).toEqual(['10', '20']);

    await h.tracker.resync();
    expect(h.snapshotCalls()).toBe(2);
    expect(Object.keys(h.tracker.current.windows)).toEqual(['10']);
    expect(h.tracker.current.seq).toBe(3);
  });

  it('start() is idempotent and stop() unsubscribes', async () => {
    const h = harness();
    const p1 = h.tracker.start();
    const p2 = h.tracker.start();
    expect(p1).toBe(p2);
    await p1;
    expect(h.snapshotCalls()).toBe(1);

    h.tracker.stop();
    expect(h.unsubscribed()).toBe(true);
  });

  it('listener registered before start receives the init event', async () => {
    const h = harness();
    const types: string[] = [];
    h.tracker.onChange((_s, e) => types.push(e.type));
    await h.tracker.start();
    expect(types).toEqual(['init']);
  });
});
