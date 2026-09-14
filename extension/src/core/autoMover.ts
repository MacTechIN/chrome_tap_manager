// core/autoMover.ts — applies rules to tabs as their URL settles (spec F-10).
//   • the user's own moves always win (tabs moved by hand are never auto-moved again),
//   • a tab already in the rule's window is left alone,
//   • every automatic move is remembered so it can be undone; 3 undos disable the rule.

import type { Rule } from './model';
import { openTopicResolver, evaluate } from './rules';
import type { Repo } from './repo';
import type { SettingsStore } from './settings';

export interface AutoMoveActions {
  moveTabs(chromeTabIds: number[], windowId: number): Promise<void>;
}

export interface AutoMove {
  id: string;
  chromeTabId: number;
  url: string;
  fromWindowId: number;
  toWindowId: number;
  toTopicName: string;
  ruleId: string;
  at: number;
}

export interface UndoResult {
  undone: boolean;
  /** Set when the undo pushed the rule past the disable threshold. */
  ruleDisabled?: Rule;
}

export const UNDO_DISABLE_THRESHOLD = 3;
const RECENT_LIMIT = 10;

export interface AutoMoverOptions {
  repo: Repo;
  settings: SettingsStore;
  actions: AutoMoveActions;
  log?: (msg: string, data?: unknown) => void;
}

export class AutoMover {
  private readonly repo: Repo;
  private readonly settings: SettingsStore;
  private readonly actions: AutoMoveActions;
  private readonly log?: (msg: string, data?: unknown) => void;
  /** Tabs the user placed deliberately this session — rules must not touch them. */
  private readonly userMoved = new Set<number>();
  /** Tabs we already routed (avoid flip-flopping on later URL updates of the same page). */
  private readonly routed = new Map<number, string>();
  private recentMoves: AutoMove[] = [];

  constructor(opts: AutoMoverOptions) {
    this.repo = opts.repo;
    this.settings = opts.settings;
    this.actions = opts.actions;
    this.log = opts.log;
  }

  markUserMoved(chromeTabIds: readonly number[]): void {
    for (const id of chromeTabIds) {
      this.userMoved.add(id);
      this.routed.delete(id);
    }
  }

  /** Forget a tab (closed). */
  forget(chromeTabId: number): void {
    this.userMoved.delete(chromeTabId);
    this.routed.delete(chromeTabId);
  }

  /**
   * Called when a tab's URL is known (created with a URL, or updated). Returns the move
   * performed, if any.
   */
  async onTabUrl(tab: {
    chromeTabId: number;
    url: string;
    windowId: number;
  }): Promise<AutoMove | undefined> {
    if (!this.settings.get().rulesEnabled) return undefined;
    if (this.userMoved.has(tab.chromeTabId)) return undefined;
    const rules = this.repo.listRules();
    if (rules.length === 0) return undefined;

    const decision = evaluate(rules, tab.url, openTopicResolver(this.repo.listTopics()));
    if (!decision) return undefined;
    if (decision.topic.windowId === tab.windowId) return undefined;
    // Same rule already routed this tab (e.g. hash/query change) → leave it.
    if (this.routed.get(tab.chromeTabId) === decision.rule.id) return undefined;

    await this.actions.moveTabs([tab.chromeTabId], decision.topic.windowId);
    this.routed.set(tab.chromeTabId, decision.rule.id);
    const move: AutoMove = {
      id: this.repo.newId(),
      chromeTabId: tab.chromeTabId,
      url: tab.url,
      fromWindowId: tab.windowId,
      toWindowId: decision.topic.windowId,
      toTopicName: decision.topic.name,
      ruleId: decision.rule.id,
      at: this.repo.now(),
    };
    this.recentMoves.unshift(move);
    if (this.recentMoves.length > RECENT_LIMIT) this.recentMoves.length = RECENT_LIMIT;
    this.log?.('rule moved tab', {
      tab: tab.chromeTabId,
      to: decision.topic.name,
      rule: decision.rule.pattern,
    });
    return move;
  }

  recent(withinMs?: number): AutoMove[] {
    const now = this.repo.now();
    return this.recentMoves.filter((m) => withinMs === undefined || now - m.at <= withinMs);
  }

  /** Move the tab back where it was and count the undo against the rule. */
  async undo(moveId: string, isWindowOpen: (windowId: number) => boolean): Promise<UndoResult> {
    const i = this.recentMoves.findIndex((m) => m.id === moveId);
    if (i === -1) return { undone: false };
    const move = this.recentMoves[i]!;
    this.recentMoves.splice(i, 1);

    if (isWindowOpen(move.fromWindowId)) {
      await this.actions.moveTabs([move.chromeTabId], move.fromWindowId);
    }
    this.markUserMoved([move.chromeTabId]);

    const rule = this.repo.listRules().find((r) => r.id === move.ruleId);
    if (!rule) return { undone: true };
    const undoCount = rule.undoCount + 1;
    const disable = undoCount >= UNDO_DISABLE_THRESHOLD;
    const updated: Rule = { ...rule, undoCount, enabled: disable ? false : rule.enabled };
    await this.repo.putRule(updated);
    if (disable) this.log?.('rule disabled after repeated undo', { rule: rule.pattern });
    return { undone: true, ruleDisabled: disable ? updated : undefined };
  }
}
