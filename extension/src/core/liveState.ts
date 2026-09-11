// core/liveState.ts — in-memory mirror of Chrome's open windows/tabs.
// Pure reducer: (state, event) -> state. No Chrome API. Every event bumps `seq`
// (monotonic, survives SW restarts via session storage) so later deltas to the
// desktop app (E10) can be ordered.
//
// Only *normal* windows are tracked; the chrome/ adapter filters window types,
// and the reducer ignores tab events for windows it does not know.

export interface LiveTab {
  id: number;
  windowId: number;
  index: number;
  url: string;
  title: string;
  favicon?: string;
  active: boolean;
  pinned: boolean;
  /** chrome.tabGroups id; -1 / undefined = none. */
  groupId?: number;
  status?: 'loading' | 'complete';
  lastAccessed?: number;
}

export interface LiveWindow {
  id: number;
  focused: boolean;
  /** Tab ids in visual order (index 0..n-1). */
  tabIds: number[];
}

export interface LiveState {
  seq: number;
  windows: Record<number, LiveWindow>;
  tabs: Record<number, LiveTab>;
  focusedWindowId?: number;
}

export interface LiveWindowInput {
  id: number;
  focused: boolean;
  tabs: LiveTab[];
}

export type TabChanges = Partial<
  Pick<LiveTab, 'url' | 'title' | 'favicon' | 'pinned' | 'groupId' | 'status'>
>;

export type LiveEvent =
  | { type: 'init'; windows: LiveWindowInput[] }
  | { type: 'window.created'; window: { id: number; focused: boolean } }
  | { type: 'window.removed'; windowId: number }
  | { type: 'window.focused'; windowId: number | undefined }
  | { type: 'tab.created'; tab: LiveTab }
  | { type: 'tab.updated'; tabId: number; changes: TabChanges }
  | { type: 'tab.removed'; tabId: number; windowId: number; isWindowClosing: boolean }
  | { type: 'tab.moved'; tabId: number; windowId: number; fromIndex: number; toIndex: number }
  | { type: 'tab.attached'; tabId: number; newWindowId: number; newPosition: number }
  | { type: 'tab.detached'; tabId: number; oldWindowId: number; oldPosition: number }
  | { type: 'tab.activated'; tabId: number; windowId: number };

export function emptyLiveState(seq = 0): LiveState {
  return { seq, windows: {}, tabs: {} };
}

/**
 * Applies one event. Returns a new state object; untouched windows/tabs are
 * shared by reference, touched ones are replaced. `seq` always increments,
 * even for ignored events, so callers can persist a strictly increasing cursor.
 */
export function reduce(state: LiveState, event: LiveEvent): LiveState {
  const next: LiveState = {
    seq: state.seq + 1,
    windows: { ...state.windows },
    tabs: { ...state.tabs },
    focusedWindowId: state.focusedWindowId,
  };

  switch (event.type) {
    case 'init': {
      next.windows = {};
      next.tabs = {};
      next.focusedWindowId = undefined;
      for (const w of event.windows) {
        const sorted = [...w.tabs].sort((a, b) => a.index - b.index);
        next.windows[w.id] = { id: w.id, focused: w.focused, tabIds: sorted.map((t) => t.id) };
        sorted.forEach((t, i) => {
          next.tabs[t.id] = { ...t, windowId: w.id, index: i };
        });
        if (w.focused) next.focusedWindowId = w.id;
      }
      return next;
    }

    case 'window.created': {
      if (next.windows[event.window.id]) return next;
      next.windows[event.window.id] = {
        id: event.window.id,
        focused: event.window.focused,
        tabIds: [],
      };
      if (event.window.focused) setFocus(next, event.window.id);
      return next;
    }

    case 'window.removed': {
      const w = next.windows[event.windowId];
      if (!w) return next;
      for (const id of w.tabIds) delete next.tabs[id];
      delete next.windows[event.windowId];
      if (next.focusedWindowId === event.windowId) next.focusedWindowId = undefined;
      return next;
    }

    case 'window.focused': {
      setFocus(next, event.windowId);
      return next;
    }

    case 'tab.created': {
      const w = next.windows[event.tab.windowId];
      if (!w) return next;
      if (next.tabs[event.tab.id]) return next;
      const tabIds = [...w.tabIds];
      const at = clamp(event.tab.index, 0, tabIds.length);
      tabIds.splice(at, 0, event.tab.id);
      next.windows[w.id] = { ...w, tabIds };
      next.tabs[event.tab.id] = { ...event.tab };
      if (event.tab.active) setActive(next, w.id, event.tab.id);
      reindex(next, w.id);
      return next;
    }

    case 'tab.updated': {
      const t = next.tabs[event.tabId];
      if (!t) return next;
      const changes: TabChanges = {};
      for (const [k, v] of Object.entries(event.changes) as [keyof TabChanges, unknown][]) {
        if (v !== undefined) (changes as Record<string, unknown>)[k] = v;
      }
      next.tabs[event.tabId] = { ...t, ...changes };
      return next;
    }

    case 'tab.removed': {
      const t = next.tabs[event.tabId];
      if (!t) return next;
      const w = next.windows[t.windowId];
      delete next.tabs[event.tabId];
      if (w) {
        next.windows[w.id] = { ...w, tabIds: w.tabIds.filter((id) => id !== event.tabId) };
        reindex(next, w.id);
      }
      // isWindowClosing: window.removed will follow and clean up the rest.
      return next;
    }

    case 'tab.moved': {
      const t = next.tabs[event.tabId];
      const w = next.windows[event.windowId];
      if (!t || !w || t.windowId !== event.windowId) return next;
      const tabIds = w.tabIds.filter((id) => id !== event.tabId);
      tabIds.splice(clamp(event.toIndex, 0, tabIds.length), 0, event.tabId);
      next.windows[w.id] = { ...w, tabIds };
      reindex(next, w.id);
      return next;
    }

    case 'tab.detached': {
      const t = next.tabs[event.tabId];
      const w = next.windows[event.oldWindowId];
      if (!t || !w) return next;
      next.windows[w.id] = { ...w, tabIds: w.tabIds.filter((id) => id !== event.tabId) };
      reindex(next, w.id);
      // Tab stays in `tabs` with a stale windowId until tab.attached arrives.
      next.tabs[event.tabId] = { ...t, active: false };
      return next;
    }

    case 'tab.attached': {
      const t = next.tabs[event.tabId];
      const w = next.windows[event.newWindowId];
      if (!t || !w) return next;
      const tabIds = w.tabIds.filter((id) => id !== event.tabId);
      tabIds.splice(clamp(event.newPosition, 0, tabIds.length), 0, event.tabId);
      next.windows[w.id] = { ...w, tabIds };
      next.tabs[event.tabId] = { ...t, windowId: w.id };
      reindex(next, w.id);
      return next;
    }

    case 'tab.activated': {
      if (!next.windows[event.windowId] || !next.tabs[event.tabId]) return next;
      setActive(next, event.windowId, event.tabId);
      return next;
    }
  }
}

function reindex(state: LiveState, windowId: number): void {
  const w = state.windows[windowId];
  if (!w) return;
  w.tabIds.forEach((id, i) => {
    const t = state.tabs[id];
    if (t && (t.index !== i || t.windowId !== windowId)) {
      state.tabs[id] = { ...t, index: i, windowId };
    }
  });
}

function setActive(state: LiveState, windowId: number, tabId: number): void {
  const w = state.windows[windowId];
  if (!w) return;
  for (const id of w.tabIds) {
    const t = state.tabs[id];
    if (!t) continue;
    const shouldBeActive = id === tabId;
    if (t.active !== shouldBeActive) state.tabs[id] = { ...t, active: shouldBeActive };
  }
}

function setFocus(state: LiveState, windowId: number | undefined): void {
  for (const w of Object.values(state.windows)) {
    const focused = w.id === windowId;
    if (w.focused !== focused) state.windows[w.id] = { ...w, focused };
  }
  state.focusedWindowId = windowId !== undefined && state.windows[windowId] ? windowId : undefined;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ---- selectors ----------------------------------------------------------

export function windowList(state: LiveState): LiveWindow[] {
  return Object.values(state.windows).sort((a, b) => a.id - b.id);
}

export function tabsOf(state: LiveState, windowId: number): LiveTab[] {
  const w = state.windows[windowId];
  if (!w) return [];
  return w.tabIds.map((id) => state.tabs[id]).filter((t): t is LiveTab => t !== undefined);
}

export function activeTabOf(state: LiveState, windowId: number): LiveTab | undefined {
  return tabsOf(state, windowId).find((t) => t.active);
}

export function counts(state: LiveState): { windows: number; tabs: number } {
  return {
    windows: Object.keys(state.windows).length,
    tabs: Object.keys(state.tabs).length,
  };
}
