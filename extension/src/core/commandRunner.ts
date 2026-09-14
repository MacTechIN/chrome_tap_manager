// core/commandRunner.ts — executes search-box actions (spec F-02, F-08, part of F-09).
// Chrome side effects go through the injected `ChromeActions`; state through Repo/TopicService.

import type { MoveLogEntry, Topic } from './model';
import { urlParts } from './rules';
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
  /** Live tabs of a window (chrome tab id + url). */
  tabsOfWindow(windowId: number): Promise<{ id: number; url: string }[]>;
  /** Closes a whole window (its topic disappears with it). */
  closeWindow(windowId: number): Promise<void>;
}

export type FocusTarget =
  | { kind: 'tab'; tabRowId: string }
  | { kind: 'topic'; topicId: string }
  | { kind: 'chromeTab'; chromeTabId: number; windowId: number };

export interface FocusResult {
  windowId: number;
  chromeTabId?: number;
}

export interface MoveResult {
  topicId: string;
  windowId: number;
  moved: number;
}

export interface CommandRunnerOptions {
  repo: Repo;
  service: TopicService;
  actions: ChromeActions;
  log?: (msg: string, data?: unknown) => void;
  /** Called after the user deliberately moved tabs (rules must never override those tabs). */
  onUserMoved?: (chromeTabIds: number[]) => void;
}

export class CommandRunner {
  private readonly repo: Repo;
  private readonly service: TopicService;
  private readonly actions: ChromeActions;
  private readonly log?: (msg: string, data?: unknown) => void;
  private readonly onUserMoved?: (chromeTabIds: number[]) => void;
  /** Last topic a tab was sent to (for the "send to last topic" shortcut). */
  lastMoveTopicId: string | undefined;

  constructor(opts: CommandRunnerOptions) {
    this.repo = opts.repo;
    this.service = opts.service;
    this.actions = opts.actions;
    this.log = opts.log;
    this.onUserMoved = opts.onUserMoved;
  }

  // ---- focus ---------------------------------------------------------------

  /**
   * mode 'tab'    : activate the tab, then focus its window
   * mode 'window' : focus the window only (keep its active tab)
   * Targets must be open: a topic lives only while its window exists.
   */
  async focus(target: FocusTarget, mode: 'tab' | 'window' = 'tab'): Promise<FocusResult> {
    if (target.kind === 'chromeTab') {
      if (mode === 'tab') await this.actions.activateTab(target.chromeTabId);
      await this.actions.focusWindow(target.windowId);
      return { windowId: target.windowId, chromeTabId: target.chromeTabId };
    }

    if (target.kind === 'topic') {
      const topic = this.requireOpenTopic(target.topicId);
      await this.actions.focusWindow(topic.windowId);
      return { windowId: topic.windowId };
    }

    const row = this.repo.getTab(target.tabRowId);
    if (!row) throw new TopicError('topic.notFound', '탭을 찾을 수 없습니다');
    const topic = this.requireOpenTopic(row.topicId);
    if (!row.isOpen || row.chromeTabId === undefined) {
      throw new TopicError('topic.notFound', '이미 닫힌 탭입니다');
    }
    if (mode === 'tab') await this.actions.activateTab(row.chromeTabId);
    await this.actions.focusWindow(topic.windowId);
    return { windowId: topic.windowId, chromeTabId: row.chromeTabId };
  }

  // ---- move / new / rename --------------------------------------------------------

  /** Send tabs to a topic's window. */
  async move(opts: {
    topicId: string;
    chromeTabIds: number[];
    switchTo?: boolean;
  }): Promise<MoveResult> {
    const topic = this.requireOpenTopic(opts.topicId);
    if (opts.chromeTabIds.length === 0)
      throw new TopicError('topic.notFound', '보낼 탭이 없습니다');

    const windowId = topic.windowId;

    // Skip tabs that are already in the target window.
    const targetRows = new Set(
      this.repo
        .listTabs({ topicId: topic.id, isOpen: true })
        .map((r) => r.chromeTabId)
        .filter((id): id is number => id !== undefined),
    );
    const toMove = opts.chromeTabIds.filter((id) => !targetRows.has(id));
    if (toMove.length > 0) await this.actions.moveTabs(toMove, windowId);
    await this.logMoves(toMove, topic.name);
    if (toMove.length > 0) this.onUserMoved?.(toMove);
    this.lastMoveTopicId = topic.id;
    if (opts.switchTo) await this.actions.focusWindow(windowId);
    this.log?.('tabs moved', { topicId: topic.id, windowId, moved: toMove.length });
    return { topicId: topic.id, windowId, moved: toMove.length };
  }

  /** Split tabs into a new window (= new topic), optionally naming it. */
  async newTopic(opts: { chromeTabIds: number[]; name?: string }): Promise<Topic> {
    const [first, ...rest] = opts.chromeTabIds;
    if (first === undefined) throw new TopicError('topic.notFound', '분리할 탭이 없습니다');
    const windowId = await this.actions.createWindow({ tabId: first, focused: true });
    if (rest.length > 0) await this.actions.moveTabs(rest, windowId);
    this.onUserMoved?.(opts.chromeTabIds);
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

  /** `>close [topic]`: close the topic's window. Returns what was closed for the confirmation UI. */
  async close(opts: { topicId?: string; windowId?: number }): Promise<{
    topicId: string;
    name: string;
    windowId: number;
    tabs: number;
  }> {
    const topic =
      opts.topicId !== undefined
        ? this.requireOpenTopic(opts.topicId)
        : opts.windowId !== undefined
          ? this.service.topicForWindow(opts.windowId)
          : undefined;
    if (!topic || topic.windowId === undefined) {
      throw new TopicError('topic.notFound', '닫을 창의 주제를 찾을 수 없습니다');
    }
    const tabs = this.repo.listTabs({ topicId: topic.id, isOpen: true }).length;
    await this.actions.closeWindow(topic.windowId);
    this.log?.('topic window closed', { topicId: topic.id, name: topic.name, tabs });
    return { topicId: topic.id, name: topic.name, windowId: topic.windowId, tabs };
  }

  // ---- helpers -------------------------------------------------------------------

  private requireOpenTopic(id: string): Topic & { windowId: number } {
    const t = this.repo.getTopic(id);
    if (!t) throw new TopicError('topic.notFound', '주제를 찾을 수 없습니다');
    if (t.status !== 'open' || t.windowId === undefined) {
      throw new TopicError('topic.notFound', '열려 있지 않은 주제입니다');
    }
    return t as Topic & { windowId: number };
  }

  private async logMoves(chromeTabIds: number[], topicName: string): Promise<void> {
    const now = this.repo.now();
    for (const id of chromeTabIds) {
      const row = this.repo.findTabByChromeId(id);
      if (!row) continue;
      const parts = urlParts(row.url);
      if (!parts) continue;
      const entry: MoveLogEntry = {
        id: this.repo.newId(),
        host: parts.host,
        pathPrefix: parts.pathPrefix,
        topicName,
        movedAt: now,
      };
      await this.repo.appendMoveLog(entry);
    }
  }
}
