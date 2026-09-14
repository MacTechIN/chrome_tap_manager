// core/ruleSuggest.ts — learn rule suggestions from the move log (spec F-10).
// "Same site sent to the same topic twice → ask once."

import { type MoveLogEntry, type Rule, topicNameKey } from './model';
import { matchRule, ruleKey } from './rules';

export const SUGGEST_MIN_MOVES = 2;
export const SUGGEST_WINDOW_MS = 7 * 24 * 3_600_000;

export interface RuleSuggestion {
  /** De-duplication key (also what "다시 묻지 않기" stores). */
  key: string;
  kind: 'host' | 'prefix';
  pattern: string;
  topicName: string;
  moves: number;
  lastMovedAt: number;
}

export interface SuggestInput {
  moveLog: readonly MoveLogEntry[];
  rules: readonly Rule[];
  dismissed: ReadonlySet<string>;
  /** Names of topics that are open right now; suggestions for others are pointless. */
  openTopicNames: readonly string[];
  now: number;
}

export function suggestRules(input: SuggestInput): RuleSuggestion[] {
  const since = input.now - SUGGEST_WINDOW_MS;
  const openKeys = new Set(input.openTopicNames.map(topicNameKey));

  // Group recent moves by (host, topic).
  const groups = new Map<string, MoveLogEntry[]>();
  for (const m of input.moveLog) {
    if (m.movedAt < since || !m.host) continue;
    const k = `${m.host}|${topicNameKey(m.topicName)}`;
    const list = groups.get(k) ?? [];
    list.push(m);
    groups.set(k, list);
  }

  const out: RuleSuggestion[] = [];
  for (const moves of groups.values()) {
    if (moves.length < SUGGEST_MIN_MOVES) continue;
    const { host, topicName } = moves[0]!;
    if (!openKeys.has(topicNameKey(topicName))) continue;

    // If every move shares a non-root path prefix, suggest the narrower prefix rule.
    const prefixes = new Set(moves.map((m) => m.pathPrefix));
    const onlyPrefix = prefixes.size === 1 ? [...prefixes][0]! : '/';
    const kind: 'host' | 'prefix' = onlyPrefix !== '/' ? 'prefix' : 'host';
    const pattern = kind === 'prefix' ? `${host}${onlyPrefix}` : host;

    const key = ruleKey(kind, pattern, topicName);
    if (input.dismissed.has(key)) continue;
    // Already covered by an existing rule that routes a sample URL to this topic → skip.
    const sample = `https://${host}${onlyPrefix === '/' ? '/' : onlyPrefix}`;
    const covered = input.rules.some(
      (r) =>
        r.enabled && topicNameKey(r.topicName) === topicNameKey(topicName) && matchRule(r, sample),
    );
    if (covered) continue;

    out.push({
      key,
      kind,
      pattern,
      topicName,
      moves: moves.length,
      lastMovedAt: Math.max(...moves.map((m) => m.movedAt)),
    });
  }
  return out.sort((a, b) => b.moves - a.moves || b.lastMovedAt - a.lastMovedAt);
}
