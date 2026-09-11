import { describe, expect, it } from 'vitest';
import {
  activeTabOf,
  counts,
  emptyLiveState,
  type LiveEvent,
  type LiveState,
  type LiveTab,
  reduce,
  tabsOf,
  windowList,
} from '../../src/core/liveState';

function tab(id: number, windowId: number, index: number, over: Partial<LiveTab> = {}): LiveTab {
  return {
    id,
    windowId,
    index,
    url: `https://example.com/${id}`,
    title: `Tab ${id}`,
    active: false,
    pinned: false,
    ...over,
  };
}

function run(events: LiveEvent[], start: LiveState = emptyLiveState()): LiveState {
  return events.reduce(reduce, start);
}

const INIT: LiveEvent = {
  type: 'init',
  windows: [
    { id: 10, focused: true, tabs: [tab(1, 10, 0, { active: true }), tab(2, 10, 1)] },
    { id: 20, focused: false, tabs: [tab(3, 20, 0, { active: true })] },
  ],
};

describe('reduce: init', () => {
  it('builds windows and tabs, normalizes index order, sets focus', () => {
    const s = reduce(emptyLiveState(), {
      type: 'init',
      windows: [
        // out-of-order indexes must be sorted and renumbered
        { id: 10, focused: true, tabs: [tab(2, 10, 5), tab(1, 10, 0)] },
      ],
    });
    expect(s.seq).toBe(1);
    expect(s.windows[10]!.tabIds).toEqual([1, 2]);
    expect(s.tabs[1]!.index).toBe(0);
    expect(s.tabs[2]!.index).toBe(1);
    expect(s.focusedWindowId).toBe(10);
    expect(counts(s)).toEqual({ windows: 1, tabs: 2 });
  });

  it('replaces previous state entirely but keeps seq monotonic', () => {
    const s1 = reduce(emptyLiveState(41), INIT);
    expect(s1.seq).toBe(42);
    const s2 = reduce(s1, { type: 'init', windows: [] });
    expect(s2.seq).toBe(43);
    expect(counts(s2)).toEqual({ windows: 0, tabs: 0 });
    expect(s2.focusedWindowId).toBeUndefined();
  });
});

describe('reduce: windows', () => {
  it('window.created adds an empty window and can take focus', () => {
    const s = run([INIT, { type: 'window.created', window: { id: 30, focused: true } }]);
    expect(s.windows[30]).toEqual({ id: 30, focused: true, tabIds: [] });
    expect(s.focusedWindowId).toBe(30);
    expect(s.windows[10]!.focused).toBe(false);
  });

  it('window.created is idempotent', () => {
    const s = run([INIT, { type: 'window.created', window: { id: 10, focused: false } }]);
    expect(s.windows[10]!.tabIds).toEqual([1, 2]);
  });

  it('window.removed deletes the window and all its tabs', () => {
    const s = run([INIT, { type: 'window.removed', windowId: 10 }]);
    expect(s.windows[10]).toBeUndefined();
    expect(s.tabs[1]).toBeUndefined();
    expect(s.tabs[2]).toBeUndefined();
    expect(s.tabs[3]).toBeDefined();
    expect(s.focusedWindowId).toBeUndefined();
  });

  it('window.focused moves focus; undefined clears it; unknown id clears it', () => {
    let s = run([INIT, { type: 'window.focused', windowId: 20 }]);
    expect(s.focusedWindowId).toBe(20);
    expect(s.windows[20]!.focused).toBe(true);
    expect(s.windows[10]!.focused).toBe(false);

    s = reduce(s, { type: 'window.focused', windowId: undefined });
    expect(s.focusedWindowId).toBeUndefined();
    expect(s.windows[20]!.focused).toBe(false);

    s = reduce(s, { type: 'window.focused', windowId: 999 });
    expect(s.focusedWindowId).toBeUndefined();
  });

  it('ignores events for unknown windows (popup/devtools) but still bumps seq', () => {
    const s0 = reduce(emptyLiveState(), INIT);
    const s = run(
      [
        { type: 'window.removed', windowId: 999 },
        { type: 'tab.created', tab: tab(50, 999, 0) },
        { type: 'tab.moved', tabId: 50, windowId: 999, fromIndex: 0, toIndex: 1 },
      ],
      s0,
    );
    expect(s.seq).toBe(s0.seq + 3);
    expect(counts(s)).toEqual(counts(s0));
  });
});

describe('reduce: tabs', () => {
  it('tab.created inserts at index and renumbers; active flag switches active tab', () => {
    const s = run([INIT, { type: 'tab.created', tab: tab(4, 10, 1, { active: true }) }]);
    expect(s.windows[10]!.tabIds).toEqual([1, 4, 2]);
    expect(tabsOf(s, 10).map((t) => t.index)).toEqual([0, 1, 2]);
    expect(activeTabOf(s, 10)?.id).toBe(4);
    expect(s.tabs[1]!.active).toBe(false);
  });

  it('tab.created clamps out-of-range index to the end', () => {
    const s = run([INIT, { type: 'tab.created', tab: tab(4, 10, 99) }]);
    expect(s.windows[10]!.tabIds).toEqual([1, 2, 4]);
    expect(s.tabs[4]!.index).toBe(2);
  });

  it('tab.updated merges defined changes only', () => {
    const s = run([
      INIT,
      {
        type: 'tab.updated',
        tabId: 1,
        changes: { title: 'New', url: undefined, status: 'complete', groupId: 7 },
      },
    ]);
    expect(s.tabs[1]).toMatchObject({
      title: 'New',
      url: 'https://example.com/1',
      status: 'complete',
      groupId: 7,
    });
  });

  it('tab.updated for unknown tab is ignored', () => {
    const s = run([INIT, { type: 'tab.updated', tabId: 999, changes: { title: 'x' } }]);
    expect(s.tabs[999]).toBeUndefined();
  });

  it('tab.removed drops the tab and renumbers the window', () => {
    const s = run([INIT, { type: 'tab.removed', tabId: 1, windowId: 10, isWindowClosing: false }]);
    expect(s.tabs[1]).toBeUndefined();
    expect(s.windows[10]!.tabIds).toEqual([2]);
    expect(s.tabs[2]!.index).toBe(0);
  });

  it('tab.moved reorders within the window', () => {
    const base = reduce(emptyLiveState(), {
      type: 'init',
      windows: [{ id: 10, focused: true, tabs: [tab(1, 10, 0), tab(2, 10, 1), tab(3, 10, 2)] }],
    });
    const s = reduce(base, { type: 'tab.moved', tabId: 1, windowId: 10, fromIndex: 0, toIndex: 2 });
    expect(s.windows[10]!.tabIds).toEqual([2, 3, 1]);
    expect(tabsOf(s, 10).map((t) => [t.id, t.index])).toEqual([
      [2, 0],
      [3, 1],
      [1, 2],
    ]);
  });

  it('tab.moved with mismatching window is ignored', () => {
    const s = run([INIT, { type: 'tab.moved', tabId: 1, windowId: 20, fromIndex: 0, toIndex: 0 }]);
    expect(s.windows[10]!.tabIds).toEqual([1, 2]);
    expect(s.windows[20]!.tabIds).toEqual([3]);
  });

  it('detach + attach moves a tab across windows and updates windowId/index', () => {
    const s = run([
      INIT,
      { type: 'tab.detached', tabId: 1, oldWindowId: 10, oldPosition: 0 },
      { type: 'tab.attached', tabId: 1, newWindowId: 20, newPosition: 1 },
    ]);
    expect(s.windows[10]!.tabIds).toEqual([2]);
    expect(s.windows[20]!.tabIds).toEqual([3, 1]);
    expect(s.tabs[1]).toMatchObject({ windowId: 20, index: 1, active: false });
    expect(s.tabs[2]!.index).toBe(0);
  });

  it('detaching the last tab then window.removed leaves the moved tab intact', () => {
    // Chrome order when dragging the only tab out: detached → attached(new window) → removed(old window)
    const s = run([
      INIT,
      { type: 'tab.detached', tabId: 3, oldWindowId: 20, oldPosition: 0 },
      { type: 'tab.attached', tabId: 3, newWindowId: 10, newPosition: 2 },
      { type: 'window.removed', windowId: 20 },
    ]);
    expect(s.windows[20]).toBeUndefined();
    expect(s.tabs[3]).toMatchObject({ windowId: 10, index: 2 });
    expect(s.windows[10]!.tabIds).toEqual([1, 2, 3]);
  });

  it('tab.activated switches the active tab within a window only', () => {
    const s = run([INIT, { type: 'tab.activated', tabId: 2, windowId: 10 }]);
    expect(activeTabOf(s, 10)?.id).toBe(2);
    expect(activeTabOf(s, 20)?.id).toBe(3);
  });
});

describe('reduce: immutability and selectors', () => {
  it('does not mutate the previous state', () => {
    const s0 = reduce(emptyLiveState(), INIT);
    const frozen = JSON.stringify(s0);
    reduce(s0, { type: 'tab.created', tab: tab(4, 10, 0, { active: true }) });
    reduce(s0, { type: 'window.removed', windowId: 10 });
    expect(JSON.stringify(s0)).toBe(frozen);
  });

  it('windowList is sorted by id; tabsOf skips dangling ids', () => {
    const s = reduce(emptyLiveState(), {
      type: 'init',
      windows: [
        { id: 30, focused: false, tabs: [] },
        { id: 10, focused: true, tabs: [tab(1, 10, 0)] },
      ],
    });
    expect(windowList(s).map((w) => w.id)).toEqual([10, 30]);
    expect(tabsOf(s, 999)).toEqual([]);
  });
});

describe('reduce: performance', () => {
  it('init with 20 windows / 200 tabs stays well under 100 ms', () => {
    const windows = Array.from({ length: 20 }, (_, w) => ({
      id: 100 + w,
      focused: w === 0,
      tabs: Array.from({ length: 10 }, (_, i) => tab(1000 + w * 10 + i, 100 + w, i)),
    }));
    const t0 = performance.now();
    const s = reduce(emptyLiveState(), { type: 'init', windows });
    const ms = performance.now() - t0;
    expect(counts(s)).toEqual({ windows: 20, tabs: 200 });
    expect(ms).toBeLessThan(100);
  });
});
