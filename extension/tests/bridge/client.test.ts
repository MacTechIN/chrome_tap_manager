import { beforeEach, describe, expect, it } from 'vitest';
import { BridgeClient, type BridgeHandlers, type SnapshotData } from '../../src/bridge/client';
import { MockHost } from '../../src/bridge/mockHost';
import { PROTOCOL_VERSION, type ProtoTab } from '../../src/bridge/protocol';

function tab(i: number): ProtoTab {
  return {
    id: i,
    windowId: 10,
    topicId: 't1',
    index: i,
    url: `https://x/${i}`,
    title: `T${i}`,
    active: i === 0,
  };
}

interface Harness {
  host: MockHost;
  client: BridgeClient;
  calls: string[];
  timers: { fn: () => void; ms: number }[];
  fire: () => void;
  seq: { value: number };
}

function harness(opts: { tabs?: number; available?: boolean; failFocus?: boolean } = {}): Harness {
  const host = new MockHost();
  host.available = opts.available ?? true;
  const calls: string[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const seq = { value: 5 };
  const tabs = Array.from({ length: opts.tabs ?? 3 }, (_, i) => tab(i));
  const handlers: BridgeHandlers = {
    snapshot: (): SnapshotData => ({
      seq: seq.value,
      topics: [
        {
          id: 't1',
          name: 'Dev',
          isNamed: true,
          windowId: 10,
          tabCount: tabs.length,
          lastActiveAt: 1,
        },
      ],
      windows: [{ id: 10, focused: true, topicId: 't1', title: 'T0 - Google Chrome' }],
      tabs,
      groups: [],
    }),
    topics: () => [
      {
        id: 't1',
        name: 'Dev',
        isNamed: true,
        windowId: 10,
        tabCount: tabs.length,
        lastActiveAt: 1,
      },
    ],
    seq: () => seq.value,
    focus: async (windowId, tabId) => {
      calls.push(`focus ${windowId}/${tabId ?? '-'}`);
      if (opts.failFocus) throw new Error('no such window');
      return { windowId, windowTitle: 'T0 - Google Chrome' };
    },
    move: async (ids, topicId, sw) => {
      calls.push(`move [${ids}] -> ${topicId}${sw ? ' switch' : ''}`);
    },
    newTopic: async (ids, name) => {
      calls.push(`new [${ids}] ${name ?? ''}`.trim());
      if (name === 'boom') throw new Error('boom');
    },
    rename: async (id, name) => {
      calls.push(`rename ${id} ${name}`);
    },
    close: async (id) => {
      calls.push(`close ${id}`);
    },
  };
  const client = new BridgeClient({
    transport: host,
    handlers,
    extVersion: '0.4.0',
    backoffInitialMs: 1000,
    backoffMaxMs: 8000,
    topicsDebounceMs: 100,
    now: () => 123,
    setTimeoutFn: ((fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeoutFn: (() => {}) as typeof clearTimeout,
  });
  return {
    host,
    client,
    calls,
    timers,
    seq,
    fire: () => {
      const t = timers.shift();
      t?.fn();
    },
  };
}

describe('BridgeClient: connect / hello / status', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('sends hello with protocol version and lastSeq on start', async () => {
    h.client.start();
    await MockHost.settle();
    expect(h.client.status()).toMatchObject({ state: 'connected', attempts: 0, connectedAt: 123 });
    expect(h.host.received).toEqual([
      {
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        extVersion: '0.4.0',
        browser: 'chrome',
        lastSeq: 5,
      },
    ]);
  });

  it('start is idempotent; stop closes the port and prevents reconnects', async () => {
    h.client.start();
    h.client.start();
    await MockHost.settle();
    expect(h.host.connections).toBe(1);
    h.client.stop();
    expect(h.client.status().state).toBe('stopped');
    expect(h.host.isOpen).toBe(false);
    expect(h.timers).toHaveLength(0);
  });
});

describe('BridgeClient: inbound commands', () => {
  let h: Harness;
  beforeEach(async () => {
    h = harness({ tabs: 450 });
    h.client.start();
    await MockHost.settle();
    h.host.received.length = 0;
  });

  it('ping → pong', async () => {
    h.host.send({ type: 'ping' });
    await MockHost.settle();
    expect(h.host.received).toEqual([{ type: 'pong' }]);
  });

  it('snapshot_request → pages of at most 200 tabs, each self-contained', async () => {
    h.host.send({ type: 'snapshot_request' });
    await MockHost.settle();
    const pages = h.host.ofType('snapshot');
    expect(pages.map((p) => [p.page, p.pages, p.tabs.length, p.seq])).toEqual([
      [1, 3, 200, 5],
      [2, 3, 200, 5],
      [3, 3, 50, 5],
    ]);
    expect(pages[2]!.tabs[0]!.id).toBe(400);
    expect(pages.every((p) => p.topics.length === 1 && p.windows.length === 1)).toBe(true);
    expect(h.client.status().lastSeqSent).toBe(5);
  });

  it('focus → handler → focus_result with window title; errors are reported, not thrown', async () => {
    h.host.send({ type: 'focus', requestId: 'r1', windowId: 10, tabId: 2 });
    await MockHost.settle();
    expect(h.calls).toEqual(['focus 10/2']);
    expect(h.host.received).toEqual([
      {
        type: 'focus_result',
        requestId: 'r1',
        ok: true,
        windowId: 10,
        windowTitle: 'T0 - Google Chrome',
      },
    ]);

    const bad = harness({ failFocus: true });
    bad.client.start();
    await MockHost.settle();
    bad.host.received.length = 0;
    bad.host.send({ type: 'focus', requestId: 'r2', windowId: 99 });
    await MockHost.settle();
    expect(bad.host.received).toEqual([
      { type: 'focus_result', requestId: 'r2', ok: false, error: 'no such window' },
    ]);
  });

  it('move / new_topic / rename / close → handlers → topics_update with requestId + ok', async () => {
    h.host.send({ type: 'move', requestId: 'a', tabIds: [1, 2], topicId: 't1', switchTo: true });
    h.host.send({ type: 'new_topic', requestId: 'b', tabIds: [3], name: 'New' });
    h.host.send({ type: 'rename', requestId: 'c', topicId: 't1', name: 'Dev2' });
    h.host.send({ type: 'close', requestId: 'd', topicId: 't1' });
    await MockHost.settle();
    expect(h.calls).toEqual([
      'move [1,2] -> t1 switch',
      'new [3] New',
      'rename t1 Dev2',
      'close t1',
    ]);
    const ups = h.host.ofType('topics_update');
    expect(ups.map((u) => [u.requestId, u.ok, u.seq, u.topics.length])).toEqual([
      ['a', true, 5, 1],
      ['b', true, 5, 1],
      ['c', true, 5, 1],
      ['d', true, 5, 1],
    ]);
  });

  it('a failing command answers ok:false with the error', async () => {
    h.host.send({ type: 'new_topic', requestId: 'e', tabIds: [1], name: 'boom' });
    await MockHost.settle();
    expect(h.host.ofType('topics_update')).toEqual([
      expect.objectContaining({ requestId: 'e', ok: false, error: 'boom' }),
    ]);
  });

  it('unknown or echoed messages are ignored', async () => {
    h.host.send({ type: 'nonsense' });
    h.host.send({ type: 'pong' });
    h.host.send({
      type: 'hello',
      protocolVersion: '0',
      extVersion: '0',
      browser: 'chrome',
      lastSeq: 0,
    });
    await MockHost.settle();
    expect(h.host.received).toEqual([]);
  });
});

describe('BridgeClient: outbound deltas and topic updates', () => {
  it('forwards live events as deltas only while connected; topics_update is debounced', async () => {
    const h = harness();
    h.client.onLiveEvent({ type: 'tab.created' }, 6); // not connected yet → dropped
    h.client.start();
    await MockHost.settle();
    h.host.received.length = 0;

    h.client.onLiveEvent({ type: 'tab.created', tab: { id: 1 } }, 7);
    h.client.onLiveEvent({ type: 'tab.activated', tabId: 1, windowId: 10 }, 8);
    expect(h.host.ofType('delta').map((d) => d.seq)).toEqual([7, 8]);
    expect(h.client.status().lastSeqSent).toBe(8);

    h.client.topicsChanged();
    h.client.topicsChanged();
    h.client.topicsChanged();
    expect(h.host.ofType('topics_update')).toHaveLength(0);
    expect(h.timers.map((t) => t.ms)).toEqual([100]);
    h.fire();
    expect(h.host.ofType('topics_update')).toHaveLength(1);
  });
});

describe('BridgeClient: reconnect with backoff', () => {
  it('missing host → disconnected, exponential retries capped at backoffMaxMs, no throw', async () => {
    const h = harness({ available: false });
    h.client.start();
    await MockHost.settle();
    expect(h.client.status()).toMatchObject({
      state: 'disconnected',
      attempts: 1,
      lastError: 'Specified native messaging host not found.',
      nextRetryMs: 1000,
    });
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      delays.push(h.timers[0]!.ms);
      h.fire();
      await MockHost.settle();
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 8000]);
    expect(h.client.status().attempts).toBe(6);
    expect(h.host.received).toEqual([]); // hello never reached a host
  });

  it('host appears later → connects, hello sent, attempts reset after a clean session', async () => {
    const h = harness({ available: false });
    h.client.start();
    await MockHost.settle();
    h.host.available = true;
    h.fire();
    await MockHost.settle();
    expect(h.client.status().state).toBe('connected');
    expect(h.host.ofType('hello')).toHaveLength(1);

    // host quits cleanly → attempts restart from 1, reconnect scheduled at the initial delay
    h.host.disconnect();
    await MockHost.settle();
    expect(h.client.status()).toMatchObject({
      state: 'disconnected',
      attempts: 1,
      nextRetryMs: 1000,
    });
  });

  it('stale port disconnects are ignored after stop()', async () => {
    const h = harness();
    h.client.start();
    await MockHost.settle();
    h.client.stop();
    h.host.disconnect('late');
    await MockHost.settle();
    expect(h.client.status().state).toBe('stopped');
  });
});
