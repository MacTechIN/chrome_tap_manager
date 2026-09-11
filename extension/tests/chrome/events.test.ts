import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  isNormalWindow,
  loadInitialState,
  subscribeChromeEvents,
  toLiveTab,
  toLiveWindowInput,
} from '../../src/chrome/events';
import type { LiveEvent } from '../../src/core/liveState';

type ChromeTab = chrome.tabs.Tab;
type ChromeWindow = chrome.windows.Window;

/**
 * @webext-core/fake-browser 2.0.1 does not implement tabs.onMoved / onAttached /
 * onDetached. Install minimal triggerable events for them before subscribing.
 */
interface TriggerableEvent<F extends (...args: never[]) => void> {
  addListener(fn: F): void;
  removeListener(fn: F): void;
  hasListener(fn: F): boolean;
  trigger(...args: Parameters<F>): void;
}
function makeEvent<F extends (...args: never[]) => void>(): TriggerableEvent<F> {
  const listeners = new Set<F>();
  return {
    addListener: (fn) => void listeners.add(fn),
    removeListener: (fn) => void listeners.delete(fn),
    hasListener: (fn) => listeners.has(fn),
    trigger: (...args) => listeners.forEach((fn) => fn(...args)),
  };
}
function installMissingTabEvents() {
  const tabs = fakeBrowser.tabs as unknown as Record<string, unknown>;
  tabs.onMoved = makeEvent<(tabId: number, info: chrome.tabs.OnMovedInfo) => void>();
  tabs.onAttached = makeEvent<(tabId: number, info: chrome.tabs.OnAttachedInfo) => void>();
  tabs.onDetached = makeEvent<(tabId: number, info: chrome.tabs.OnDetachedInfo) => void>();
}
const extraTabEvents = () => ({
  onMoved: fakeBrowser.tabs.onMoved as unknown as TriggerableEvent<
    (tabId: number, info: chrome.tabs.OnMovedInfo) => void
  >,
  onAttached: fakeBrowser.tabs.onAttached as unknown as TriggerableEvent<
    (tabId: number, info: chrome.tabs.OnAttachedInfo) => void
  >,
  onDetached: fakeBrowser.tabs.onDetached as unknown as TriggerableEvent<
    (tabId: number, info: chrome.tabs.OnDetachedInfo) => void
  >,
});

function chromeTab(over: Partial<ChromeTab> = {}): ChromeTab {
  return {
    id: 1,
    windowId: 10,
    index: 0,
    url: 'https://example.com/',
    title: 'Example',
    favIconUrl: 'https://example.com/favicon.ico',
    active: true,
    pinned: false,
    highlighted: true,
    incognito: false,
    selected: true,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    status: 'complete',
    frozen: false,
    ...over,
  } as ChromeTab;
}

function chromeWindow(over: Partial<ChromeWindow> = {}): ChromeWindow {
  return {
    id: 10,
    focused: true,
    type: 'normal',
    state: 'normal',
    incognito: false,
    alwaysOnTop: false,
    tabs: [chromeTab()],
    ...over,
  } as ChromeWindow;
}

describe('toLiveTab / toLiveWindowInput', () => {
  it('maps fields, treats groupId -1 as none, empty favicon as undefined', () => {
    const t = toLiveTab(chromeTab({ favIconUrl: '', groupId: -1, status: 'loading' }));
    expect(t).toEqual({
      id: 1,
      windowId: 10,
      index: 0,
      url: 'https://example.com/',
      title: 'Example',
      favicon: undefined,
      active: true,
      pinned: false,
      groupId: undefined,
      status: 'loading',
      lastAccessed: undefined,
    });
  });

  it('falls back to pendingUrl and keeps a real groupId', () => {
    const t = toLiveTab(chromeTab({ url: undefined, pendingUrl: 'https://p/', groupId: 5 }));
    expect(t?.url).toBe('https://p/');
    expect(t?.groupId).toBe(5);
  });

  it('returns undefined for tabs without id/windowId', () => {
    expect(toLiveTab(chromeTab({ id: undefined }))).toBeUndefined();
  });

  it('window input only for normal windows', () => {
    expect(isNormalWindow({ type: 'popup' })).toBe(false);
    expect(toLiveWindowInput(chromeWindow({ type: 'popup' }))).toBeUndefined();
    const w = toLiveWindowInput(chromeWindow());
    expect(w).toEqual({
      id: 10,
      focused: true,
      tabs: [expect.objectContaining({ id: 1, windowId: 10 })],
    });
  });
});

describe('loadInitialState (fake browser)', () => {
  beforeEach(() => fakeBrowser.reset());

  it('produces an init event from windows.getAll', async () => {
    const w = (await fakeBrowser.windows.create({ focused: true }))!;
    await fakeBrowser.tabs.create({ windowId: w.id, url: 'https://a/', active: true });
    await fakeBrowser.tabs.create({ windowId: w.id, url: 'https://b/' });

    const ev = await loadInitialState();
    expect(ev.type).toBe('init');
    if (ev.type !== 'init') return;
    const win = ev.windows.find((x) => x.id === w.id);
    expect(win).toBeDefined();
    expect(win!.tabs.map((t) => t.url).sort()).toEqual(['https://a/', 'https://b/']);
  });
});

describe('subscribeChromeEvents (fake browser triggers)', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    installMissingTabEvents();
  });

  function capture(): { events: LiveEvent[]; off: () => void } {
    const events: LiveEvent[] = [];
    const off = subscribeChromeEvents((e) => events.push(e));
    return { events, off };
  }

  it('window events: created (normal only), removed, focus (-1 → undefined)', () => {
    const { events, off } = capture();
    fakeBrowser.windows.onCreated.trigger(chromeWindow({ id: 10 }));
    fakeBrowser.windows.onCreated.trigger(chromeWindow({ id: 11, type: 'popup' }));
    fakeBrowser.windows.onRemoved.trigger(10);
    fakeBrowser.windows.onFocusChanged.trigger(-1);
    fakeBrowser.windows.onFocusChanged.trigger(12);
    off();
    expect(events).toEqual([
      { type: 'window.created', window: { id: 10, focused: true } },
      { type: 'window.removed', windowId: 10 },
      { type: 'window.focused', windowId: undefined },
      { type: 'window.focused', windowId: 12 },
    ]);
  });

  it('tab events map 1:1 with normalized payloads', () => {
    const { events, off } = capture();
    fakeBrowser.tabs.onCreated.trigger(chromeTab({ id: 1 }));
    fakeBrowser.tabs.onUpdated.trigger(1, { title: 'New', favIconUrl: '' }, chromeTab({ id: 1 }));
    fakeBrowser.tabs.onUpdated.trigger(1, { groupId: -1 }, chromeTab({ id: 1 }));
    const extra = extraTabEvents();
    extra.onMoved.trigger(1, { windowId: 10, fromIndex: 0, toIndex: 2 });
    extra.onDetached.trigger(1, { oldWindowId: 10, oldPosition: 2 });
    extra.onAttached.trigger(1, { newWindowId: 20, newPosition: 0 });
    fakeBrowser.tabs.onActivated.trigger({ tabId: 1, windowId: 20 });
    fakeBrowser.tabs.onRemoved.trigger(1, { windowId: 20, isWindowClosing: false });
    off();

    expect(events.map((e) => e.type)).toEqual([
      'tab.created',
      'tab.updated',
      'tab.updated',
      'tab.moved',
      'tab.detached',
      'tab.attached',
      'tab.activated',
      'tab.removed',
    ]);
    expect(events[1]).toEqual({
      type: 'tab.updated',
      tabId: 1,
      changes: { title: 'New', favicon: undefined },
    });
    expect(events[2]).toEqual({ type: 'tab.updated', tabId: 1, changes: { groupId: undefined } });
    expect(events[3]).toEqual({
      type: 'tab.moved',
      tabId: 1,
      windowId: 10,
      fromIndex: 0,
      toIndex: 2,
    });
    expect(events[7]).toEqual({
      type: 'tab.removed',
      tabId: 1,
      windowId: 20,
      isWindowClosing: false,
    });
  });

  it('tab.updated with no relevant changes is dropped', () => {
    const { events, off } = capture();
    fakeBrowser.tabs.onUpdated.trigger(1, { audible: true }, chromeTab({ id: 1 }));
    off();
    expect(events).toEqual([]);
  });

  it('unsubscribe stops forwarding', () => {
    const { events, off } = capture();
    off();
    fakeBrowser.tabs.onCreated.trigger(chromeTab({ id: 1 }));
    expect(events).toEqual([]);
  });
});
