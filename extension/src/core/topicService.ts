// core/topicService.ts — "one window = one Topic" lifecycle (spec F-01, F-04).
// Consumes LiveEvents (+ the resulting LiveState) and keeps the Repo consistent:
//   window.created  → Topic(open, auto-named)
//   window.removed  → Topic(saved) with its tab list preserved; unnamed+empty → deleted
//   tab.*           → Tab rows (topicId = topic of the tab's window, fingerprint, index)
//   rename / deleteSaved are the user-facing mutations.
// Pure with respect to Chrome: everything comes in through events and the Repo.

import { autoName, nameFromTabs, nextUnnamed } from './autoName';
import { fingerprint } from './fingerprint';
import {
  groupsOf,
  type LiveEvent,
  type LiveGroup,
  type LiveState,
  type LiveTab,
  tabsOf,
} from './liveState';
import {
  type Subgroup,
  type Tab,
  type Topic,
  TOPIC_NAME_MAX,
  type TopicColor,
  topicNameKey,
} from './model';
import type { Repo } from './repo';

const TOPIC_COLORS: readonly TopicColor[] = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
];

export function toTopicColor(c: string | undefined): TopicColor | undefined {
  return (TOPIC_COLORS as readonly string[]).includes(c ?? '') ? (c as TopicColor) : undefined;
}

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

export interface TreeTab {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  chromeTabId?: number;
  isOpen: boolean;
  index: number;
  subgroupId?: string;
  lastActiveAt: number;
}

export interface TreeSubgroup {
  id: string;
  name: string;
  color?: TopicColor;
  collapsed: boolean;
  tabs: TreeTab[];
}

export interface TopicTree extends TopicSummary {
  subgroups: TreeSubgroup[];
  /** Tabs not in any subgroup. */
  tabs: TreeTab[];
}

function toTreeTab(t: Tab): TreeTab {
  return {
    id: t.id,
    title: t.title,
    url: t.url,
    favicon: t.favicon,
    chromeTabId: t.chromeTabId,
    isOpen: t.isOpen,
    index: t.index,
    subgroupId: t.subgroupId,
    lastActiveAt: t.lastActiveAt,
  };
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
        case 'group.created':
        case 'group.updated':
          await this.onGroupUpsert(event.group, state);
          break;
        case 'group.removed':
          await this.onGroupRemoved(event.groupId);
          break;
      }
    });
  }

  // ---- sub-groups (Chrome tab groups, read-only mirror; spec F-03) ----------------

  /** Subgroup row for a live Chrome group, matched by chromeGroupId, else by name within the topic. */
  private findSubgroup(topicId: string, live: LiveGroup): Subgroup | undefined {
    const rows = this.repo.listSubgroups(topicId);
    return (
      rows.find((g) => g.chromeGroupId === live.id) ??
      rows.find((g) => g.chromeGroupId === undefined && g.name === live.title)
    );
  }

  private subgroupIdFor(topicId: string, chromeGroupId: number | undefined): string | undefined {
    if (chromeGroupId === undefined) return undefined;
    return this.repo.listSubgroups(topicId).find((g) => g.chromeGroupId === chromeGroupId)?.id;
  }

  private async onGroupUpsert(live: LiveGroup, state: LiveState): Promise<void> {
    if (!state.windows[live.windowId]) return;
    const topic = await this.ensureTopicForWindow(live.windowId, state);
    const existing = this.findSubgroup(topic.id, live);
    const row: Subgroup = {
      id: existing?.id ?? this.repo.newId(),
      topicId: topic.id,
      name: live.title,
      color: toTopicColor(live.color),
      chromeGroupId: live.id,
      collapsed: live.collapsed,
    };
    if (
      !existing ||
      existing.topicId !== row.topicId ||
      existing.name !== row.name ||
      existing.color !== row.color ||
      existing.chromeGroupId !== row.chromeGroupId ||
      existing.collapsed !== row.collapsed
    ) {
      await this.repo.putSubgroup(row);
    }
    // Tabs may have joined the group before we knew it: re-bind their subgroupId.
    await this.syncTabsOfWindow(topic, live.windowId, state);
  }

  /**
   * A group vanished. If it still has open tabs the user ungrouped them → delete the
   * subgroup. If all its tabs are closed the window is closing → keep the subgroup
   * (name/color survive in the saved topic) but drop the Chrome id.
   */
  private async onGroupRemoved(chromeGroupId: number): Promise<void> {
    const row = this.repo.listSubgroups().find((g) => g.chromeGroupId === chromeGroupId);
    if (!row) return;
    const tabs = this.repo
      .listTabs({ topicId: row.topicId })
      .filter((t) => t.subgroupId === row.id);
    if (tabs.length === 0 || tabs.some((t) => t.isOpen)) {
      await this.repo.deleteSubgroup(row.id);
      return;
    }
    await this.repo.putSubgroup({ ...row, chromeGroupId: undefined });
  }

  /** Reconcile subgroup rows of an open topic with the live groups of its window. */
  private async syncGroupsOfWindow(
    topic: Topic,
    windowId: number,
    state: LiveState,
  ): Promise<void> {
    const live = groupsOf(state, windowId);
    const liveIds = new Set(live.map((g) => g.id));
    for (const g of live) await this.onGroupUpsert(g, state);
    for (const row of this.repo.listSubgroups(topic.id)) {
      if (row.chromeGroupId !== undefined && !liveIds.has(row.chromeGroupId)) {
        const tabs = this.repo
          .listTabs({ topicId: topic.id })
          .filter((t) => t.subgroupId === row.id);
        if (tabs.length === 0) await this.repo.deleteSubgroup(row.id);
        else await this.repo.putSubgroup({ ...row, chromeGroupId: undefined });
      }
    }
  }

  // ---- reconcile (init / resync) ------------------------------------------

  /**
   * Bring the Repo in line with a full LiveState snapshot.
   * Fresh session: all stored open topics become saved first (windowIds are stale).
   */
  async reconcile(state: LiveState): Promise<void> {
    const now = this.repo.now();
    const liveWindowIds = new Set(Object.keys(state.windows).map(Number));

    if (this.freshSession) {
      // Browser restart / extension reload: every stored windowId is stale (Chrome reuses ids).
      // Re-link stale open topics to live windows by tab-fingerprint overlap instead of
      // blindly saving them — otherwise each reload leaves a duplicate "saved" copy of
      // every open window, and restoring one of those opens a second identical window.
      const stale = this.repo.listTopics().filter((t) => t.status === 'open');
      const matched = this.matchWindows(stale, liveWindowIds, state, RELINK_MIN_JACCARD);
      for (const [windowId, topic] of matched) await this.relink(topic, windowId, state, now);
      for (const t of stale) {
        if (![...matched.values()].some((m) => m.id === t.id)) await this.toSaved(t, now);
      }
      this.freshSession = false;
    }

    // Open topics whose window vanished while the SW was dead → saved.
    for (const t of this.repo.listTopics()) {
      if (t.status === 'open' && (t.windowId === undefined || !liveWindowIds.has(t.windowId))) {
        await this.toSaved(t, now);
      }
    }

    for (const windowId of liveWindowIds) {
      const topic = await this.ensureTopicForWindow(windowId, state);
      await this.syncGroupsOfWindow(topic, windowId, state);
      await this.syncTabsOfWindow(topic, windowId, state);
    }

    // Open tab rows whose chrome tab no longer exists → drop (they were closed while asleep).
    for (const row of this.repo.listTabs({ isOpen: true })) {
      if (row.chromeTabId === undefined || !state.tabs[row.chromeTabId]) {
        await this.repo.deleteTab(row.id);
      }
    }

    await this.dropDuplicateSavedTopics();

    // Legacy cleanup: `saved` topics from earlier versions. Duplicates of open windows were
    // absorbed above (their names carried over); whatever is left has no window → drop.
    for (const t of this.repo.listTopics()) {
      if (t.status === 'saved') {
        await this.repo.deleteTopic(t.id);
        this.log?.('saved topic purged (no window)', { id: t.id, name: t.name });
      }
    }

    this.lastFocusedWindowId = state.focusedWindowId;
    this.log?.('topics reconciled', {
      topics: this.repo.listTopics().length,
      openTabs: this.repo.listTabs({ isOpen: true }).length,
    });
  }

  /** Greedy best-overlap assignment: each live window gets at most one topic and vice versa. */
  private matchWindows(
    candidates: readonly Topic[],
    liveWindowIds: Set<number>,
    state: LiveState,
    minJaccard: number,
  ): Map<number, Topic> {
    const topicFps = new Map(candidates.map((t) => [t.id, this.topicFingerprints(t.id)] as const));
    const pairs: { windowId: number; topic: Topic; score: number }[] = [];
    for (const windowId of liveWindowIds) {
      const live = liveFingerprints(state, windowId);
      if (live.size === 0) continue;
      for (const topic of candidates) {
        const score = jaccard(live, topicFps.get(topic.id)!);
        if (score >= minJaccard) pairs.push({ windowId, topic, score });
      }
    }
    pairs.sort((a, b) => b.score - a.score);
    const out = new Map<number, Topic>();
    const usedTopics = new Set<string>();
    for (const p of pairs) {
      if (out.has(p.windowId) || usedTopics.has(p.topic.id)) continue;
      out.set(p.windowId, p.topic);
      usedTopics.add(p.topic.id);
    }
    return out;
  }

  /** Re-attach an existing topic to a live window; tab rows are re-bound by fingerprint. */
  private async relink(topic: Topic, windowId: number, state: LiveState, now: number) {
    const rows = this.repo.listTabs({ topicId: topic.id });
    // Detach every row first (stale chromeTabIds), then syncTabsOfWindow re-binds by fingerprint.
    await this.repo.putTabs(
      rows.map((r) => ({ ...r, isOpen: false, chromeTabId: undefined, updatedAt: now })),
    );
    const open: Topic = { ...topic, status: 'open', windowId, updatedAt: now };
    await this.repo.putTopic(open);
    await this.syncTabsOfWindow(open, windowId, state);
    // Rows that found no live tab are gone from this window → drop (window = topic).
    for (const r of this.repo.listTabs({ topicId: topic.id })) {
      if (!r.isOpen) await this.repo.deleteTab(r.id);
    }
    this.log?.('topic relinked', { id: topic.id, name: topic.name, windowId });
  }

  /**
   * Unnamed saved topics that duplicate an open window (≥ DUPLICATE_MIN_JACCARD overlap)
   * are artifacts of earlier reloads — remove them. Named ones are the user's data: keep.
   */
  /**
   * Saved topics that duplicate an open window (≥ DUPLICATE_MIN_JACCARD overlap) are
   * artifacts of earlier reloads. They are absorbed into the open topic: an unnamed open
   * topic inherits the duplicate's name, then the duplicate is deleted. Restoring such a
   * copy would open a second identical window (user-reported bug).
   */
  private async dropDuplicateSavedTopics(): Promise<void> {
    for (const s of this.repo.listTopics()) {
      if (s.status !== 'saved') continue;
      await this.absorbIfDuplicate(s.id);
    }
  }

  /** The open topic whose window this saved topic duplicates, if any. */
  openDuplicateOf(savedTopicId: string): Topic | undefined {
    const saved = this.repo.getTopic(savedTopicId);
    if (!saved || saved.status !== 'saved') return undefined;
    const fps = this.topicFingerprints(saved.id);
    if (fps.size === 0) return undefined;
    let best: { topic: Topic; score: number } | undefined;
    for (const o of this.repo.listTopics()) {
      if (o.status !== 'open') continue;
      const score = jaccard(fps, this.topicFingerprints(o.id));
      if (score >= DUPLICATE_MIN_JACCARD && (!best || score > best.score))
        best = { topic: o, score };
    }
    return best?.topic;
  }

  /**
   * If `savedTopicId` duplicates an open window, merge it into that open topic and return
   * the open topic; otherwise return undefined and leave everything untouched.
   */
  async absorbIfDuplicate(savedTopicId: string): Promise<Topic | undefined> {
    const open = this.openDuplicateOf(savedTopicId);
    if (!open) return undefined;
    return this.repo.batch(async () => {
      const saved = this.repo.getTopic(savedTopicId)!;
      let target = this.repo.getTopic(open.id)!;
      if (saved.isNamed && !target.isNamed) {
        const key = topicNameKey(saved.name);
        const clash = this.repo
          .listTopics()
          .find(
            (t) =>
              t.id !== saved.id && t.id !== target.id && t.isNamed && topicNameKey(t.name) === key,
          );
        if (!clash) {
          target = { ...target, name: saved.name, isNamed: true, updatedAt: this.repo.now() };
          await this.repo.putTopic(target);
        }
      }
      await this.repo.deleteTopic(saved.id);
      this.log?.('duplicate saved topic absorbed', {
        saved: saved.name,
        into: target.name,
        windowId: target.windowId,
      });
      return target;
    });
  }

  private topicFingerprints(topicId: string): Set<string> {
    return new Set(this.repo.listTabs({ topicId }).map((r) => r.fingerprint));
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

  async setColor(topicId: string, color: TopicColor | undefined): Promise<Topic> {
    const topic = this.repo.getTopic(topicId);
    if (!topic) throw new TopicError('topic.notFound');
    const next: Topic = { ...topic, updatedAt: this.repo.now() };
    if (color === undefined) delete next.color;
    else next.color = color;
    return this.repo.putTopic(next);
  }

  /** Tree for the side panel: open topics first, each with its subgroups and tabs. */
  tree(): TopicTree[] {
    const subgroupsByTopic = new Map<string, Subgroup[]>();
    for (const g of this.repo.listSubgroups()) {
      const list = subgroupsByTopic.get(g.topicId) ?? [];
      list.push(g);
      subgroupsByTopic.set(g.topicId, list);
    }
    return this.listTopics().map((summary) => {
      const tabs = this.repo
        .listTabs({ topicId: summary.id })
        .sort((a, b) => a.index - b.index)
        .map(toTreeTab);
      const groups = (subgroupsByTopic.get(summary.id) ?? []).map((g) => ({
        id: g.id,
        name: g.name,
        color: g.color,
        collapsed: g.collapsed,
        tabs: tabs.filter((t) => t.subgroupId === g.id),
      }));
      const grouped = new Set(groups.flatMap((g) => g.tabs.map((t) => t.id)));
      return {
        ...summary,
        subgroups: groups,
        tabs: tabs.filter((t) => !grouped.has(t.id)),
      };
    });
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

  /**
   * A window went away. Only topics the user named survive as `saved`; an unnamed
   * (auto-named) topic is dropped with its tab list — otherwise every closed window
   * lingers in search and the side panel (user feedback 2026-09-12).
   */
  /**
   * A window went away → its topic goes with it (tabs and subgroups cascade).
   * Product decision 2026-09-12: a topic lives exactly as long as its window; nothing is
   * kept for windows that are not open, named or not. (Chrome's own session restore
   * brings windows back after a restart, and `reconcile` re-links them by fingerprint.)
   */
  private async toSaved(topic: Topic, _now: number): Promise<void> {
    await this.repo.deleteTopic(topic.id);
    this.log?.('topic dropped with its window', { id: topic.id, name: topic.name });
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
      subgroupId: this.subgroupIdFor(topicId, live.groupId),
      index: live.index,
      isOpen: true,
      lastActiveAt: existing?.lastActiveAt ?? now,
      updatedAt: now,
    };
  }

  private async syncTabsOfWindow(topic: Topic, windowId: number, state: LiveState): Promise<void> {
    const live = tabsOf(state, windowId);
    // Closed rows of this topic can be re-bound to live tabs with the same fingerprint
    // (restore / relink), so ids, lastActiveAt and subgroup survive.
    const closedByFp = new Map<string, Tab[]>();
    for (const r of this.repo.listTabs({ topicId: topic.id, isOpen: false })) {
      const list = closedByFp.get(r.fingerprint) ?? [];
      list.push(r);
      closedByFp.set(r.fingerprint, list);
    }
    const rows: Tab[] = [];
    for (const t of live) {
      let existing = this.repo.findTabByChromeId(t.id);
      if (!existing) existing = closedByFp.get(fingerprint(t.url, t.title))?.shift();
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

/** Overlap needed to re-link a stale topic to a live window after a reload/restart. */
export const RELINK_MIN_JACCARD = 0.5;
/** Overlap at which an unnamed saved topic is considered a duplicate of an open window. */
export const DUPLICATE_MIN_JACCARD = 0.8;

export function liveFingerprints(state: LiveState, windowId: number): Set<string> {
  return new Set(tabsOf(state, windowId).map((t) => fingerprint(t.url, t.title)));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
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
    a.isOpen === b.isOpen &&
    a.subgroupId === b.subgroupId
  );
}
