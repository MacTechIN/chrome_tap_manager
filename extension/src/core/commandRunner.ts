// core/commandRunner.ts — executes search-box actions (spec F-02, F-08, part of F-09).
// Chrome side effects go through the injected `ChromeActions`; state through Repo/TopicService.

import { normalizeUrl } from './fingerprint';
import type { MoveLogEntry, Tab, Topic } from './model';
import type { Repo } from './repo';
import { TopicError, type TopicService } from './topicService';

export interface ChromeActions {
  activateTab(chromeTabId: number): Promise<void>;
  focusWindow(windowId: number): Promise<void>;
  /** Moves tabs to the end of `windowId`. */
  moveTabs(chromeTabIds: number[], windowId: number): Promise<void>;
  /** Creates a normal window from an existing tab or from URLs; resolves with the new windowId. */
  createWindow(opts: { tabId?: number; urls?: string[]; focused?: boolean }): Promise<number>;
  /** Resolves once the window is known to the live tracker / topic service. */
  waitForWindow(windowId: number): Promise<void>;
  /** Live tabs of a window (chrome tab id + url), used after restoring a saved topic. */
  tabsOfWindow(windowId: number): Promise<{ id: number; url: string }[]>;
}

export type FocusTarget =
  | { kind: 'tab'; tabRowId: string }
  | { kind: 'topic'; topicId: string }
  | { kind: 'chromeTab'; chromeTabId: number; windowId: number };

export interface FocusResult {
  windowId: number;
  chromeTabId?: number;
  restored: boolean;
}

export interface MoveResult {
  topicId: string;
  windowId: number;
  moved: number;
  restored: boolean;
}

export interface CommandRunnerOptions {
  repo: Repo;
  service: TopicService;
  actions: ChromeActions;
  log?: (msg: string, data?: unknown) => void;
}

export class CommandRunner {
  private readonly repo: Repo;
  private readonly service: TopicService;
  private readonly actions: ChromeActions;
  private readonly log?: (msg: string, data?: unknown) => void;
  /** Last topic a tab was sent to (for the "send to last topic" shortcut). */
  lastMoveTopicId: string | undefined;

  constructor(opts: CommandRunnerOptions) {
    this.repo = opts.repo;
    this.service = opts.service;
    this.actions = opts.actions;
    this.log = opts.log;
  }

  // ---- focus ---------------------------------------------------------------

  /**
   * mode 'tab'    : activate the tab, then focus its window
   * mode 'window' : focus the window only (keep its active tab)
   * Saved targets are restored into a new window first.
   */
  async focus(target: FocusTarget, mode: 'tab' | 'window' = 'tab'): Promise<FocusResult> {
    if (target.kind === 'chromeTab') {
      if (mode === 'tab') await this.actions.activateTab(target.chromeTabId);
      await this.actions.focusWindow(target.windowId);
      return { windowId: target.windowId, chromeTabId: target.chromeTabId, restored: false };
    }

    if (target.kind === 'topic') {
      const topic = this.requireTopic(target.topicId);
      if (topic.status === 'open' && topic.windowId !== undefined) {
        await this.actions.focusWindow(topic.windowId);
        return { windowId: topic.windowId, restored: false };
      }
      const windowId = await this.restoreTopic(topic.id);
      await this.actions.focusWindow(windowId);
      return { windowId, restored: true };
    }

    const row = this.repo.getTab(target.tabRowId);
    if (!row) throw new TopicError('topic.notFound', '탭을 찾을 수 없습니다');
    const topic = this.requireTopic(row.topicId);

    if (row.isOpen && row.chromeTabId !== undefined && topic.windowId !== undefined) {
      if (mode === 'tab') await this.actions.activateTab(row.chromeTabId);
      await this.actions.focusWindow(topic.windowId);
      return { windowId: topic.windowId, chromeTabId: row.chromeTabId, restored: false };
    }

    // Saved tab: restore its topic (or open it in the topic's live window) and activate by URL.
    let windowId: number;
    let restored = false;
    if (topic.status === 'open' && topic.windowId !== undefined) {
      windowId = topic.windowId;
    } else {
      windowId = await this.restoreTopic(topic.id);
      restored = true;
    }
    const live = await this.actions.tabsOfWindow(windowId);
    const want = normalizeUrl(row.url);
    const match = live.find((t) => normalizeUrl(t.url) === want);
    if (match && mode === 'tab') await this.actions.activateTab(match.id);
    await this.actions.focusWindow(windowId);
    return { windowId, chromeTabId: match?.id, restored };
  }

  // ---- restore (saved topic → window) -----------------------------------------

  async restoreTopic(topicId: string): Promise<number> {
    const topic = this.requireTopic(topicId);
    if (topic.status === 'open' && topic.windowId !== undefined) return topic.windowId;

    const urls = this.savedTabs(topicId).map((t) => t.url);
    const windowId = await this.actions.createWindow({
      urls: urls.length > 0 ? urls : undefined,
      focused: true,
    });
    await this.actions.waitForWindow(windowId);
    await this.service.adoptWindow(topicId, windowId);
    this.log?.('topic restored', { topicId, windowId, tabs: urls.length });
    return windowId;
  }

  // ---- move / new / rename --------------------------------------------------------

  /** Send tabs to a topic's window (restoring it if saved). */
  async move(opts: {
    topicId: string;
    chromeTabIds: number[];
    switchTo?: boolean;
  }): Promise<MoveResult> {
    const topic = this.requireTopic(opts.topicId);
    if (opts.chromeTabIds.length === 0)
      throw new TopicError('topic.notFound', '보낼 탭이 없습니다');

    let windowId: number;
    let restored = false;
    if (topic.status === 'open' && topic.windowId !== undefined) {
      windowId = topic.windowId;
    } else {
      windowId = await this.restoreTopic(topic.id);
      restored = true;
    }

    // Skip tabs that are already in the target window.
    const targetRows = new Set(
      this.repo
        .listTabs({ topicId: topic.id, isOpen: true })
        .map((r) => r.chromeTabId)
        .filter((id): id is number => id !== undefined),
    );
    const toMove = opts.chromeTabIds.filter((id) => !targetRows.has(id));
    if (toMove.length > 0) await this.actions.moveTabs(toMove, windowId);
    await this.logMoves(toMove, topic.id);
    this.lastMoveTopicId = topic.id;
    if (opts.switchTo) await this.actions.focusWindow(windowId);
    this.log?.('tabs moved', { topicId: topic.id, windowId, moved: toMove.length });
    return { topicId: topic.id, windowId, moved: toMove.length, restored };
  }

  /** Split tabs into a new window (= new topic), optionally naming it. */
  async newTopic(opts: { chromeTabIds: number[]; name?: string }): Promise<Topic> {
    const [first, ...rest] = opts.chromeTabIds;
    if (first === undefined) throw new TopicError('topic.notFound', '분리할 탭이 없습니다');
    const windowId = await this.actions.createWindow({ tabId: first, focused: true });
    if (rest.length > 0) await this.actions.moveTabs(rest, windowId);
    await this.actions.waitForWindow(windowId);
    let topic = this.service.topicForWindow(windowId);
    if (!topic) throw new TopicError('topic.notFound', '새 창의 주제를 찾을 수 없습니다');
    if (opts.name && opts.name.trim()) topic = await this.service.rename(topic.id, opts.name);
    this.lastMoveTopicId = topic.id;
    this.log?.('new topic window', { topicId: topic.id, windowId, name: topic.name });
    return topic;
  }

  async rename(opts: { name: string; topicId?: string; windowId?: number }): Promise<Topic> {
    const topicId =
      opts.topicId ??
      (opts.windowId !== undefined ? this.service.topicForWindow(opts.windowId)?.id : undefined);
    if (!topicId) throw new TopicError('topic.notFound', '현재 창의 주제를 찾을 수 없습니다');
    return this.service.rename(topicId, opts.name);
  }

  /** Move every tab of the current window into `topicId`; the emptied window closes by itself. */
  async merge(opts: { topicId: string; fromWindowId: number }): Promise<MoveResult> {
    const from = this.service.topicForWindow(opts.fromWindowId);
    if (!from) throw new TopicError('topic.notFound', '현재 창의 주제를 찾을 수 없습니다');
    if (from.id === opts.topicId) throw new TopicError('topic.notFound', '같은 주제입니다');
    const ids = this.repo
      .listTabs({ topicId: from.id, isOpen: true })
      .map((r) => r.chromeTabId)
      .filter((id): id is number => id !== undefined);
    return this.move({ topicId: opts.topicId, chromeTabIds: ids, switchTo: true });
  }

  // ---- helpers -------------------------------------------------------------------

  private requireTopic(id: string): Topic {
    const t = this.repo.getTopic(id);
    if (!t) throw new TopicError('topic.notFound', '주제를 찾을 수 없습니다');
    return t;
  }

  private savedTabs(topicId: string): Tab[] {
    return this.repo
      .listTabs({ topicId })
      .filter((t) => !t.isOpen)
      .sort((a, b) => a.index - b.index);
  }

  private async logMoves(chromeTabIds: number[], topicId: string): Promise<void> {
    const now = this.repo.now();
    for (const id of chromeTabIds) {
      const row = this.repo.findTabByChromeId(id);
      if (!row) continue;
      let host = '';
      let pathPrefix = '/';
      try {
        const u = new URL(row.url);
        host = u.hostname.replace(/^www\./, '');
        pathPrefix = u.pathname.split('/').slice(0, 2).join('/') || '/';
      } catch {
        continue;
      }
      const entry: MoveLogEntry = {
        id: this.repo.newId(),
        host,
        pathPrefix,
        topicId,
        movedAt: now,
      };
      await this.repo.appendMoveLog(entry);
    }
  }
}
