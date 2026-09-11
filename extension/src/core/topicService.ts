// core/topicService.ts — "one window = one Topic" lifecycle (spec F-01, F-04).
// Consumes LiveEvents (+ the resulting LiveState) and keeps the Repo consistent:
//   window.created  → Topic(open, auto-named)
//   window.removed  → Topic(saved) with its tab list preserved; unnamed+empty → deleted
//   tab.*           → Tab rows (topicId = topic of the tab's window, fingerprint, index)
//   rename / deleteSaved are the user-facing mutations.
// Pure with respect to Chrome: everything comes in through events and the Repo.

import { autoName, nameFromTabs, nextUnnamed } from './autoName';
import { fingerprint } from './fingerprint';
import { type LiveEvent, type LiveState, type LiveTab, tabsOf } from './liveState';
import { type Tab, type Topic, TOPIC_NAME_MAX, topicNameKey } from './model';
import type { Repo } from './repo';

export type TopicErrorCode =
  'topic.notFound' | 'topic.notSaved' | 'name.empty' | 'name.tooLong' | 'name.duplicate';

export class TopicError extends Error {
  constructor(
    readonly code: TopicErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'TopicError';
  }
}

export interface TopicSummary {
  id: string;
  name: string;
  isNamed: boolean;
  status: Topic['status'];
  windowId?: number;
  color?: Topic['color'];
  tabCount: number;
  lastActiveAt: number;
}

export interface TopicServiceOptions {
  repo: Repo;
  /**
   * True when the browser session is new (no session marker in storage.session):
   * every stored `open` Topic's windowId is stale and must not be trusted.
   */
  freshSession: boolean;
  browser?: string;
  log?: (msg: string, data?: unknown) => void;
}

export class TopicService {
  private readonly repo: Repo;
  private readonly browser: string;
  private readonly log?: (msg: string, data?: unknown) => void;
  private freshSession: boolean;
  private lastFocusedWindowId: number | undefined;

  constructor(opts: TopicServiceOptions) {
    this.repo = opts.repo;
    this.browser = opts.browser ?? 'chrome';
    this.log = opts.log;
    this.freshSession = opts.freshSession;
  }

  // ---- event entry point -------------------------------------------------

  async apply(event: LiveEvent, state: LiveState): Promise<void> {
    await this.repo.batch(async () => {
      switch (event.type) {
        case 'init':
          await this.reconcile(state);
          break;
        case 'window.created':
          await this.ensureTopicForWindow(event.window.id, state);
          if (event.window.focused) await this.onFocusChanged(event.window.id, state);
          break;
        case 'window.removed':
          await this.onWindowRemoved(event.windowId);
          break;
        case 'window.focused':
          await this.onFocusChanged(event.windowId, state);
          break;
        case 'tab.created':
          await this.onTabCreated(event.tab, state);
          break;
        case 'tab.updated':
          await this.onTabUpdated(event.tabId, state);
          break;
        case 'tab.removed':
          await this.onTabRemoved(event.tabId, event.isWindowClosing);
          break;
        case 'tab.moved':
          await this.syncIndexes(event.windowId, state);
          break;
        case 'tab.detached':
          // Wait for tab.attached; the row keeps its old topic until then.
          break;
        case 'tab.attached':
          await this.onTabAttached(event.tabId, event.newWindowId, state);
          break;
        case 'tab.activated':
          await this.onTabActivated(event.tabId, event.windowId);
          break;
      }
    });
  }

  // ---- reconcile (init / resync) ------------------------------------------

  /**
   * Bring the Repo in line with a full LiveState snapshot.
   * Fresh session: all stored open topics become saved first (windowIds are stale).
   */
  async reconcile(state: LiveState): Promise<void> {
    const now = this.repo.now();

    if (this.freshSession) {
      for (const t of this.repo.listTopics()) {
        if (t.status === 'open') await this.toSaved(t, now);
      }
      this.freshSession = false;
    }

    const liveWindowIds = new Set(Object.keys(state.windows).map(Number));

    // Open topics whose window vanished while the SW was dead → saved.
    for (const t of this.repo.listTopics()) {
      if (t.status === 'open' && (t.windowId === undefined || !liveWindowIds.has(t.windowId))) {
        await this.toSaved(t, now);
      }
    }

    for (const windowId of liveWindowIds) {
      const topic = await this.ensureTopicForWindow(windowId, state);
      await this.syncTabsOfWindow(topic, windowId, state);
    }

    // Open tab rows whose chrome tab no longer exists → drop (they were closed while asleep).
    for (const row of this.repo.listTabs({ isOpen: true })) {
      if (row.chromeTabId === undefined || !state.tabs[row.chromeTabId]) {
        await this.repo.deleteTab(row.id);
      }
    }

    this.lastFocusedWindowId = state.focusedWindowId;
    this.log?.('topics reconciled', {
      topics: this.repo.listTopics().length,
      openTabs: this.repo.listTabs({ isOpen: true }).length,
    });
  }

  // ---- user mutations -----------------------------------------------------

  async rename(topicId: string, rawName: string): Promise<Topic> {
    const topic = this.repo.getTopic(topicId);
    if (!topic) throw new TopicError('topic.notFound');
    const name = rawName.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (name.length === 0) throw new TopicError('name.empty');
    if (name.length > TOPIC_NAME_MAX) throw new TopicError('name.tooLong');
    const key = topicNameKey(name);
    const clash = this.repo
      .listTopics()
      .find((t) => t.id !== topicId && t.isNamed && topicNameKey(t.name) === key);
    if (clash) throw new TopicError('name.duplicate', `이미 있는 이름: ${clash.name}`);

    const now = this.repo.now();
    return this.repo.putTopic({ ...topic, name, isNamed: true, updatedAt: now });
  }

  async deleteSaved(topicId: string): Promise<void> {
    const topic = this.repo.getTopic(topicId);
    if (!topic) throw new TopicError('topic.notFound');
    if (topic.status !== 'saved')
      throw new TopicError('topic.notSaved', '열려 있는 주제는 삭제할 수 없습니다');
    await this.repo.deleteTopic(topicId);
  }

  listTopics(): TopicSummary[] {
    const counts = new Map<string, number>();
    for (const t of this.repo.listTabs()) counts.set(t.topicId, (counts.get(t.topicId) ?? 0) + 1);
    return this.repo
      .listTopics()
      .map((t) => ({
        id: t.id,
        name: t.name,
        isNamed: t.isNamed,
        status: t.status,
        windowId: t.windowId,
        color: t.color,
        tabCount: counts.get(t.id) ?? 0,
        lastActiveAt: t.lastActiveAt,
      }))
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
        return b.lastActiveAt - a.lastActiveAt;
      });
  }

  topicForWindow(windowId: number): Topic | undefined {
    return this.repo.findTopicByWindow(windowId);
  }

  /**
   * Re-link a saved topic to a freshly created window (restore). If the window
   * already got an auto-created topic (event raced ahead of us), merge that topic
   * into the saved one. Closed rows of the saved topic are dropped: the window was
   * created from them and live tab events re-create the rows.
   */
  async adoptWindow(topicId: string, windowId: number): Promise<Topic> {
    return this.repo.batch(async () => {
      const topic = this.repo.getTopic(topicId);
      if (!topic) throw new TopicError('topic.notFound');
      if (topic.status === 'open' && topic.windowId === windowId) return topic;
      if (topic.status === 'open') {
        throw new TopicError('topic.notSaved', '이미 다른 창에 열려 있는 주제입니다');
      }
      const now = this.repo.now();

      for (const row of this.repo.listTabs({ topicId })) {
        if (!row.isOpen) await this.repo.deleteTab(row.id);
      }

      const auto = this.repo.findTopicByWindow(windowId);
      if (auto && auto.id !== topicId) {
        const rows = this.repo.listTabs({ topicId: auto.id }).map((r) => ({ ...r, topicId }));
        if (rows.length > 0) await this.repo.putTabs(rows);
        await this.repo.deleteTopic(auto.id);
      }

      const adopted: Topic = {
        ...topic,
        status: 'open',
        windowId,
        lastActiveAt: now,
        updatedAt: now,
      };
      await this.repo.putTopic(adopted);
      this.log?.('topic adopted window', { topicId, windowId, merged: auto?.id });
      return adopted;
    });
  }

  // ---- internals: topics ---------------------------------------------------

  private async ensureTopicForWindow(windowId: number, state: LiveState): Promise<Topic> {
    const existing = this.repo.findTopicByWindow(windowId);
    if (existing) return existing;
    const now = this.repo.now();
    const tabs = tabsOf(state, windowId);
    const topic: Topic = {
      id: this.repo.newId(),
      name: autoName(
        tabs,
        this.repo.listTopics().map((t) => t.name),
      ),
      isNamed: false,
      status: 'open',
      windowId,
      browser: this.browser,
      lastActiveAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.putTopic(topic);
    this.log?.('topic created', { id: topic.id, name: topic.name, windowId });
    return topic;
  }

  private async toSaved(topic: Topic, now: number): Promise<void> {
    const rows = this.repo.listTabs({ topicId: topic.id });
    const closed = rows
      .filter((r) => r.isOpen)
      .map((r) => ({ ...r, isOpen: false, chromeTabId: undefined, updatedAt: now }));
    if (closed.length > 0) await this.repo.putTabs(closed);

    if (!topic.isNamed && rows.length === 0) {
      await this.repo.deleteTopic(topic.id);
      this.log?.('unnamed empty topic dropped', { id: topic.id });
      return;
    }
    await this.repo.putTopic({ ...topic, status: 'saved', windowId: undefined, updatedAt: now });
    this.log?.('topic saved', { id: topic.id, name: topic.name, tabs: rows.length });
  }

  private async onWindowRemoved(windowId: number): Promise<void> {
    const topic = this.repo.findTopicByWindow(windowId);
    if (!topic) return;
    if (this.lastFocusedWindowId === windowId) this.lastFocusedWindowId = undefined;
    await this.toSaved(topic, this.repo.now());
  }

  private async onFocusChanged(windowId: number | undefined, state: LiveState): Promise<void> {
    const now = this.repo.now();
    const previous = this.lastFocusedWindowId;
    this.lastFocusedWindowId = windowId;

    // Refresh the provisional name of the window we just left (spec: on focus loss).
    if (previous !== undefined && previous !== windowId) {
      await this.refreshAutoName(previous, state, { force: true });
    }
    if (windowId !== undefined) {
      const topic = this.repo.findTopicByWindow(windowId);
      if (topic && topic.lastActiveAt !== now) {
        await this.repo.putTopic({ ...topic, lastActiveAt: now });
      }
    }
  }

  /**
   * Recompute an unnamed topic's provisional name.
   * Without `force`, only while the window has at most one tab (first tab defines the name).
   */
  private async refreshAutoName(
    windowId: number,
    state: LiveState,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    const topic = this.repo.findTopicByWindow(windowId);
    if (!topic || topic.isNamed) return;
    const tabs = tabsOf(state, windowId);
    if (!opts.force && tabs.length > 1) return;
    const derived = nameFromTabs(tabs);
    const name =
      derived ??
      (topic.name.startsWith('새 주제')
        ? topic.name
        : nextUnnamed(this.repo.listTopics().map((t) => t.name)));
    if (name !== topic.name) {
      await this.repo.putTopic({ ...topic, name, updatedAt: this.repo.now() });
    }
  }

  // ---- internals: tabs -----------------------------------------------------

  private rowFor(live: LiveTab, topicId: string, existing?: Tab): Tab {
    const now = this.repo.now();
    return {
      id: existing?.id ?? this.repo.newId(),
      topicId,
      fingerprint: fingerprint(live.url, live.title),
      url: live.url,
      title: live.title,
      favicon: live.favicon,
      chromeTabId: live.id,
      subgroupId: existing?.subgroupId,
      index: live.index,
      isOpen: true,
      lastActiveAt: existing?.lastActiveAt ?? now,
      updatedAt: now,
    };
  }

  private async syncTabsOfWindow(topic: Topic, windowId: number, state: LiveState): Promise<void> {
    const live = tabsOf(state, windowId);
    const rows: Tab[] = [];
    for (const t of live) {
      const existing = this.repo.findTabByChromeId(t.id);
      const row = this.rowFor(t, topic.id, existing);
      if (!existing || !sameRow(existing, row)) rows.push(row);
    }
    if (rows.length > 0) await this.repo.putTabs(rows);
  }

  private async onTabCreated(tab: LiveTab, state: LiveState): Promise<void> {
    if (!state.windows[tab.windowId]) return; // non-normal window
    const topic = await this.ensureTopicForWindow(tab.windowId, state);
    const existing = this.repo.findTabByChromeId(tab.id);
    await this.repo.putTab(this.rowFor(tab, topic.id, existing));
    await this.syncIndexes(tab.windowId, state);
    await this.refreshAutoName(tab.windowId, state);
  }

  private async onTabUpdated(chromeTabId: number, state: LiveState): Promise<void> {
    const live = state.tabs[chromeTabId];
    if (!live || !state.windows[live.windowId]) return;
    const topic = await this.ensureTopicForWindow(live.windowId, state);
    const existing = this.repo.findTabByChromeId(chromeTabId);
    const row = this.rowFor(live, topic.id, existing);
    if (!existing || !sameRow(existing, row)) await this.repo.putTab(row);
    await this.refreshAutoName(live.windowId, state);
  }

  private async onTabRemoved(chromeTabId: number, isWindowClosing: boolean): Promise<void> {
    const row = this.repo.findTabByChromeId(chromeTabId);
    if (!row) return;
    if (isWindowClosing) {
      // Keep it: the window is closing and its Topic becomes `saved` with this tab list.
      await this.repo.putTab({
        ...row,
        isOpen: false,
        chromeTabId: undefined,
        updatedAt: this.repo.now(),
      });
      return;
    }
    await this.repo.deleteTab(row.id);
  }

  private async onTabAttached(
    chromeTabId: number,
    newWindowId: number,
    state: LiveState,
  ): Promise<void> {
    const live = state.tabs[chromeTabId];
    if (!live || !state.windows[newWindowId]) return;
    const topic = await this.ensureTopicForWindow(newWindowId, state);
    const existing = this.repo.findTabByChromeId(chromeTabId);
    const oldWindowId = existing ? this.repo.getTopic(existing.topicId)?.windowId : undefined;
    await this.repo.putTab(this.rowFor(live, topic.id, existing));
    await this.syncIndexes(newWindowId, state);
    if (oldWindowId !== undefined && oldWindowId !== newWindowId) {
      await this.syncIndexes(oldWindowId, state);
    }
    await this.refreshAutoName(newWindowId, state);
  }

  private async onTabActivated(chromeTabId: number, windowId: number): Promise<void> {
    const now = this.repo.now();
    const row = this.repo.findTabByChromeId(chromeTabId);
    if (row && row.lastActiveAt !== now) {
      await this.repo.putTab({ ...row, lastActiveAt: now });
    }
    const topic = this.repo.findTopicByWindow(windowId);
    if (topic && topic.lastActiveAt !== now) {
      await this.repo.putTopic({ ...topic, lastActiveAt: now });
    }
  }

  private async syncIndexes(windowId: number, state: LiveState): Promise<void> {
    const changed: Tab[] = [];
    for (const live of tabsOf(state, windowId)) {
      const row = this.repo.findTabByChromeId(live.id);
      if (row && row.index !== live.index) changed.push({ ...row, index: live.index });
    }
    if (changed.length > 0) await this.repo.putTabs(changed);
  }
}

function sameRow(a: Tab, b: Tab): boolean {
  return (
    a.topicId === b.topicId &&
    a.fingerprint === b.fingerprint &&
    a.url === b.url &&
    a.title === b.title &&
    a.favicon === b.favicon &&
    a.chromeTabId === b.chromeTabId &&
    a.index === b.index &&
    a.isOpen === b.isOpen
  );
}
