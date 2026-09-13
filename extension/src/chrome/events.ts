// chrome/events.ts — thin adapter from chrome.windows / chrome.tabs events to
// core LiveEvent objects. No state here; the reducer in core/liveState.ts owns it.

import { browser } from '#imports';
import type { LiveEvent, LiveGroup, LiveTab, LiveWindowInput, TabChanges } from '../core/liveState';

type ChromeTab = chrome.tabs.Tab;
type ChromeWindow = chrome.windows.Window;

const WINDOW_ID_NONE = -1;
const GROUP_ID_NONE = -1;

/** Real Chrome always sets `type`; a missing type (test fakes) is treated as normal. */
export function isNormalWindow(w: Pick<ChromeWindow, 'type'>): boolean {
  return w.type === undefined || w.type === 'normal';
}

export function toLiveTab(t: ChromeTab): LiveTab | undefined {
  if (t.id === undefined || t.windowId === undefined) return undefined;
  return {
    id: t.id,
    windowId: t.windowId,
    index: t.index,
    url: t.url ?? t.pendingUrl ?? '',
    title: t.title ?? '',
    favicon: t.favIconUrl || undefined,
    active: t.active,
    pinned: t.pinned,
    groupId: t.groupId !== undefined && t.groupId !== GROUP_ID_NONE ? t.groupId : undefined,
    status: t.status === 'loading' || t.status === 'complete' ? t.status : undefined,
    lastAccessed: t.lastAccessed,
  };
}

export function toLiveWindowInput(w: ChromeWindow): LiveWindowInput | undefined {
  if (w.id === undefined || !isNormalWindow(w)) return undefined;
  const tabs = (w.tabs ?? []).map(toLiveTab).filter((t): t is LiveTab => t !== undefined);
  return { id: w.id, focused: w.focused, tabs };
}

/** Full snapshot of all normal windows, as an 'init' event. */
export function toLiveGroup(g: chrome.tabGroups.TabGroup): LiveGroup {
  return {
    id: g.id,
    windowId: g.windowId,
    title: g.title ?? '',
    color: g.color,
    collapsed: g.collapsed,
  };
}

/** chrome.tabGroups exists only with the "tabGroups" permission (E08+); older builds/fakes lack it. */
function tabGroupsApi(): typeof chrome.tabGroups | undefined {
  return (browser as unknown as { tabGroups?: typeof chrome.tabGroups }).tabGroups;
}

export async function loadInitialState(): Promise<LiveEvent> {
  const all = await browser.windows.getAll({ populate: true, windowTypes: ['normal'] });
  const windows = all.map(toLiveWindowInput).filter((w): w is LiveWindowInput => w !== undefined);
  const api = tabGroupsApi();
  let groups: LiveGroup[] | undefined;
  if (api) {
    try {
      groups = (await api.query({})).map(toLiveGroup);
    } catch {
      groups = undefined;
    }
  }
  return { type: 'init', windows, groups };
}

/**
 * Subscribes to every relevant Chrome event and forwards normalized LiveEvents.
 * Returns an unsubscribe function. Must be called synchronously at SW top level
 * so listeners are registered before the worker goes idle.
 */
export function subscribeChromeEvents(dispatch: (e: LiveEvent) => void): () => void {
  const onWindowCreated = (w: ChromeWindow) => {
    if (w.id === undefined || !isNormalWindow(w)) return;
    dispatch({ type: 'window.created', window: { id: w.id, focused: w.focused } });
  };
  const onWindowRemoved = (windowId: number) => {
    dispatch({ type: 'window.removed', windowId });
  };
  const onWindowFocus = (windowId: number) => {
    dispatch({
      type: 'window.focused',
      windowId: windowId === WINDOW_ID_NONE ? undefined : windowId,
    });
  };
  const onTabCreated = (t: ChromeTab) => {
    const tab = toLiveTab(t);
    if (tab) dispatch({ type: 'tab.created', tab });
  };
  const onTabUpdated = (tabId: number, info: chrome.tabs.OnUpdatedInfo) => {
    const changes: TabChanges = {};
    if (info.url !== undefined) changes.url = info.url;
    if (info.title !== undefined) changes.title = info.title;
    if (info.favIconUrl !== undefined) changes.favicon = info.favIconUrl || undefined;
    if (info.pinned !== undefined) changes.pinned = info.pinned;
    if (info.groupId !== undefined) {
      changes.groupId = info.groupId === GROUP_ID_NONE ? undefined : info.groupId;
    }
    if (info.status === 'loading' || info.status === 'complete') changes.status = info.status;
    if (Object.keys(changes).length === 0 && info.groupId === undefined) return;
    dispatch({ type: 'tab.updated', tabId, changes });
  };
  const onTabRemoved = (tabId: number, info: chrome.tabs.OnRemovedInfo) => {
    dispatch({
      type: 'tab.removed',
      tabId,
      windowId: info.windowId,
      isWindowClosing: info.isWindowClosing,
    });
  };
  const onTabMoved = (tabId: number, info: chrome.tabs.OnMovedInfo) => {
    dispatch({
      type: 'tab.moved',
      tabId,
      windowId: info.windowId,
      fromIndex: info.fromIndex,
      toIndex: info.toIndex,
    });
  };
  const onTabAttached = (tabId: number, info: chrome.tabs.OnAttachedInfo) => {
    dispatch({
      type: 'tab.attached',
      tabId,
      newWindowId: info.newWindowId,
      newPosition: info.newPosition,
    });
  };
  const onTabDetached = (tabId: number, info: chrome.tabs.OnDetachedInfo) => {
    dispatch({
      type: 'tab.detached',
      tabId,
      oldWindowId: info.oldWindowId,
      oldPosition: info.oldPosition,
    });
  };
  const onTabActivated = (info: chrome.tabs.OnActivatedInfo) => {
    dispatch({ type: 'tab.activated', tabId: info.tabId, windowId: info.windowId });
  };

  browser.windows.onCreated.addListener(onWindowCreated);
  browser.windows.onRemoved.addListener(onWindowRemoved);
  browser.windows.onFocusChanged.addListener(onWindowFocus);
  browser.tabs.onCreated.addListener(onTabCreated);
  browser.tabs.onUpdated.addListener(onTabUpdated);
  browser.tabs.onRemoved.addListener(onTabRemoved);
  browser.tabs.onMoved.addListener(onTabMoved);
  browser.tabs.onAttached.addListener(onTabAttached);
  browser.tabs.onDetached.addListener(onTabDetached);
  browser.tabs.onActivated.addListener(onTabActivated);

  const groupsApi = tabGroupsApi();
  const onGroupCreated = (g: chrome.tabGroups.TabGroup) =>
    dispatch({ type: 'group.created', group: toLiveGroup(g) });
  const onGroupUpdated = (g: chrome.tabGroups.TabGroup) =>
    dispatch({ type: 'group.updated', group: toLiveGroup(g) });
  const onGroupMoved = (g: chrome.tabGroups.TabGroup) =>
    dispatch({ type: 'group.updated', group: toLiveGroup(g) });
  const onGroupRemoved = (g: chrome.tabGroups.TabGroup) =>
    dispatch({ type: 'group.removed', groupId: g.id });
  // Group events are optional (permission may be absent; test fakes are partial): never let
  // them break window/tab tracking.
  let groupsSubscribed = false;
  if (groupsApi) {
    try {
      groupsApi.onCreated.addListener(onGroupCreated);
      groupsApi.onUpdated.addListener(onGroupUpdated);
      groupsApi.onMoved.addListener(onGroupMoved);
      groupsApi.onRemoved.addListener(onGroupRemoved);
      groupsSubscribed = true;
    } catch {
      groupsSubscribed = false;
    }
  }

  return () => {
    if (groupsApi && groupsSubscribed) {
      groupsApi.onCreated.removeListener(onGroupCreated);
      groupsApi.onUpdated.removeListener(onGroupUpdated);
      groupsApi.onMoved.removeListener(onGroupMoved);
      groupsApi.onRemoved.removeListener(onGroupRemoved);
    }
    browser.windows.onCreated.removeListener(onWindowCreated);
    browser.windows.onRemoved.removeListener(onWindowRemoved);
    browser.windows.onFocusChanged.removeListener(onWindowFocus);
    browser.tabs.onCreated.removeListener(onTabCreated);
    browser.tabs.onUpdated.removeListener(onTabUpdated);
    browser.tabs.onRemoved.removeListener(onTabRemoved);
    browser.tabs.onMoved.removeListener(onTabMoved);
    browser.tabs.onAttached.removeListener(onTabAttached);
    browser.tabs.onDetached.removeListener(onTabDetached);
    browser.tabs.onActivated.removeListener(onTabActivated);
  };
}
